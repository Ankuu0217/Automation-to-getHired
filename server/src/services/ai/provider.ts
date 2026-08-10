import type {
  EmailDraft,
  JobExtraction,
  JobMatch,
  MatchAnalysisInput,
  OutreachEmailInput,
} from '@jobmail/shared';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import {
  analyzeMatchWithGemini,
  extractTextWithGemini,
  extractWithGemini,
  generateEmailWithGemini,
} from './gemini';
import { ocrImage } from './ocr';
import { extractFromText } from './heuristics';
import { analyzeMatchHeuristic, generateEmailFromTemplate } from './outreach';
import { repairOutreachEmail } from '../emailRules';

/**
 * Pluggable AI provider (SPEC §2). M2 uses extractJobFromImage; M3 adds
 * analyzeMatch + generateOutreachEmail. Both providers share the same
 * deterministic fallback (services/ai/outreach): the Gemini provider
 * degrades to it on API failure, the OCR-only provider uses it directly.
 *
 * Swap-in path for another vendor (e.g. OpenAI): implement AIProvider in a
 * sibling module and select it in getAIProvider() from an env var.
 */
export interface AIProvider {
  readonly name: string;
  extractJobFromImage(
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ extraction: JobExtraction; source: 'vision' | 'ocr'; rawText: string }>;
  /** Extract from pasted job-post text (Phase 2, POST /jobs/import). Same output contract. */
  extractJobFromText(
    rawText: string,
  ): Promise<{ extraction: JobExtraction; source: 'vision' | 'ocr'; rawText: string }>;
  /** Match jdText against the candidate profile (SPEC §4 Step B). */
  analyzeMatch(input: MatchAnalysisInput): Promise<JobMatch>;
  /** Draft the outreach email (SPEC §4 Step C). Output is rule-repaired before return. */
  generateOutreachEmail(input: OutreachEmailInput): Promise<EmailDraft>;
}

/** A blank, editable extraction — the last-resort result when nothing could be read. */
function emptyExtraction(): JobExtraction {
  return {
    company: null,
    role: null,
    location: null,
    jdText: '',
    hrName: null,
    hrEmails: [],
    confidence: 0,
  };
}

/**
 * OCR-only pipeline: tesseract.js → regex/heuristics. Always available and
 * NEVER throws: if the OCR engine itself fails (worker/model download, corrupt
 * image), we return an empty extraction so the caller degrades to a manual
 * review step instead of dead-ending the user on "couldn't read this one".
 */
async function extractViaOcr(
  buffer: Buffer,
): Promise<{ extraction: JobExtraction; source: 'ocr'; rawText: string }> {
  try {
    const text = await ocrImage(buffer);
    const { extraction, rawText } = extractFromText(text);
    return { extraction, source: 'ocr', rawText };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'OCR failed — returning empty extraction for manual review',
    );
    return { extraction: emptyExtraction(), source: 'ocr', rawText: '' };
  }
}

/** Heuristics-only text pipeline (no OCR step — the text is already text). Always available. */
function extractTextViaHeuristics(
  text: string,
): { extraction: JobExtraction; source: 'ocr'; rawText: string } {
  const { extraction, rawText } = extractFromText(text);
  return { extraction, source: 'ocr', rawText };
}

class GeminiVisionProvider implements AIProvider {
  readonly name = 'gemini-vision';

  async extractJobFromImage(buffer: Buffer, mimeType: string) {
    try {
      const { extraction, rawText } = await extractWithGemini(buffer, mimeType);
      return { extraction, source: 'vision' as const, rawText };
    } catch (err) {
      // SPEC §9.8 — vision API down/quota/bad output → degrade to OCR mode.
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Vision extraction failed, falling back to OCR',
      );
      return extractViaOcr(buffer);
    }
  }

  async extractJobFromText(rawText: string) {
    try {
      const { extraction } = await extractTextWithGemini(rawText);
      // Keep the USER'S pasted text as rawExtractedText — the model's raw
      // JSON response must never replace the source the user provided.
      return { extraction, source: 'vision' as const, rawText };
    } catch (err) {
      // Same degradation contract as images: API down/quota/bad output → heuristics.
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Gemini text extraction failed, falling back to heuristics',
      );
      return extractTextViaHeuristics(rawText);
    }
  }

  async analyzeMatch(input: MatchAnalysisInput): Promise<JobMatch> {
    try {
      return await analyzeMatchWithGemini(input);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Gemini match analysis failed, falling back to heuristics',
      );
      return analyzeMatchHeuristic(input);
    }
  }

  async generateOutreachEmail(input: OutreachEmailInput): Promise<EmailDraft> {
    try {
      const { subject, bodyText } = await generateEmailWithGemini(input);
      // Hard rules are enforced server-side regardless of model compliance.
      return repairOutreachEmail({ subject, bodyText, bodyHtml: '' });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Gemini email generation failed, falling back to template',
      );
      return generateEmailFromTemplate(input);
    }
  }
}

class OcrOnlyProvider implements AIProvider {
  readonly name = 'ocr-only';

  async extractJobFromImage(buffer: Buffer) {
    return extractViaOcr(buffer);
  }

  async extractJobFromText(rawText: string) {
    return extractTextViaHeuristics(rawText);
  }

  async analyzeMatch(input: MatchAnalysisInput): Promise<JobMatch> {
    return analyzeMatchHeuristic(input);
  }

  async generateOutreachEmail(input: OutreachEmailInput): Promise<EmailDraft> {
    return generateEmailFromTemplate(input);
  }
}

let cached: AIProvider | null = null;

/**
 * Singleton provider selected by env: Gemini vision when GEMINI_API_KEY is
 * set, otherwise OCR-only.
 */
export function getAIProvider(): AIProvider {
  if (cached) return cached;
  const key = env.GEMINI_API_KEY;
  cached = key && key.length > 0 ? new GeminiVisionProvider() : new OcrOnlyProvider();
  return cached;
}

/** Test hook: reset the cached provider singleton. */
export function resetAIProvider(): void {
  cached = null;
}
