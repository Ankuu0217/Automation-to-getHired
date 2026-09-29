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
import { draftQualityProblem, finalizeOutreachEmail } from './emailWriter';
import {
  analyzeMatchOR,
  extractJobImageOR,
  extractJobTextOR,
  generateEmailOR,
  isOpenRouterConfigured,
} from './openrouter';

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
  if (!env.OCR_ENABLED) {
    // Small/free hosts: skip CPU-heavy OCR — the user fills the review form by hand.
    return { extraction: emptyExtraction(), source: 'ocr', rawText: '' };
  }
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

/**
 * One AI "engine" = one vendor's implementation of the four operations.
 * The provider walks the engines in order (OpenRouter first, Gemini second)
 * and only then degrades to OCR / heuristics / the template — so a flaky or
 * rate-limited model never reaches the user as a failure.
 */
interface Engine {
  name: string;
  extractImage(buffer: Buffer, mimeType: string): Promise<{ extraction: JobExtraction; rawText: string }>;
  extractText(rawText: string): Promise<{ extraction: JobExtraction }>;
  match(input: MatchAnalysisInput): Promise<JobMatch>;
  email(input: OutreachEmailInput): Promise<{ subject: string; bodyText: string }>;
}

const openRouterEngine: Engine = {
  name: 'openrouter',
  extractImage: extractJobImageOR,
  extractText: extractJobTextOR,
  match: analyzeMatchOR,
  email: generateEmailOR,
};

const geminiEngine: Engine = {
  name: 'gemini',
  extractImage: extractWithGemini,
  extractText: extractTextWithGemini,
  match: analyzeMatchWithGemini,
  email: async (input) => {
    const draft = await generateEmailWithGemini(input);
    const problem = draftQualityProblem(draft, input);
    if (problem) logger.info({ problem }, 'Gemini draft below the bar — kept (no better engine left)');
    return draft;
  },
};

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 300) : String(err);
}

class ChainProvider implements AIProvider {
  readonly name: string;
  constructor(private readonly engines: Engine[]) {
    this.name = engines.map((e) => e.name).join('+');
  }

  private async first<T>(op: string, run: (e: Engine) => Promise<T>): Promise<T> {
    let last: unknown = new Error('no AI engine configured');
    for (const engine of this.engines) {
      try {
        return await run(engine);
      } catch (err) {
        last = err;
        logger.warn({ op, engine: engine.name, err: errMsg(err) }, 'AI engine failed — trying the next one');
      }
    }
    throw last;
  }

  async extractJobFromImage(buffer: Buffer, mimeType: string) {
    try {
      const { extraction, rawText } = await this.first('extract-image', (e) => e.extractImage(buffer, mimeType));
      return { extraction, source: 'vision' as const, rawText };
    } catch {
      // SPEC §9.8 — every vision engine down/quota/bad output → degrade to OCR.
      return extractViaOcr(buffer);
    }
  }

  async extractJobFromText(rawText: string) {
    try {
      const { extraction } = await this.first('extract-text', (e) => e.extractText(rawText));
      // Keep the USER'S pasted text as rawExtractedText, never the model's JSON.
      return { extraction, source: 'vision' as const, rawText };
    } catch {
      return extractTextViaHeuristics(rawText);
    }
  }

  async analyzeMatch(input: MatchAnalysisInput): Promise<JobMatch> {
    try {
      return await this.first('match', (e) => e.match(input));
    } catch {
      return analyzeMatchHeuristic(input);
    }
  }

  async generateOutreachEmail(input: OutreachEmailInput): Promise<EmailDraft> {
    try {
      const raw = await this.first('email', (e) => e.email(input));
      // Human finishing pass + exact signature + hard rules, whatever the model wrote.
      return finalizeOutreachEmail(raw, input);
    } catch {
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
 * Singleton provider selected by env: OpenRouter (OPENROUTER_API_KEY) first,
 * Gemini (GEMINI_API_KEY) as a second engine, OCR/heuristics-only when neither.
 */
export function getAIProvider(): AIProvider {
  if (cached) return cached;
  const engines: Engine[] = [];
  if (isOpenRouterConfigured()) engines.push(openRouterEngine);
  if (env.GEMINI_API_KEY) engines.push(geminiEngine);
  cached = engines.length > 0 ? new ChainProvider(engines) : new OcrOnlyProvider();
  return cached;
}

/** Test hook: reset the cached provider singleton. */
export function resetAIProvider(): void {
  cached = null;
}
