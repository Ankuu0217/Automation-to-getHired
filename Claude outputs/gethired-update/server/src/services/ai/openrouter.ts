import {
  matchAnalysisSchema,
  type JobExtraction,
  type JobMatch,
  type MatchAnalysisInput,
  type OutreachEmailInput,
} from '@jobmail/shared';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { findFirstJsonObject, parseExtractionJson } from './parseExtraction';
import {
  buildMatchPrompt,
  EXTRACTION_PROMPT,
  RESUME_PROMPT,
  resumeAiSchema,
  TEXT_EXTRACTION_PROMPT,
  type ResumeAiResult,
} from './gemini';
import { buildEmailPrompt, draftQualityProblem, emailDraftSchema, type RawEmailDraft } from './emailWriter';

/**
 * OpenRouter engine — one API key, many models, automatic failover.
 *
 * Free models come and go and are individually rate-limited, so every call
 * walks a chain until one model returns valid, good-enough JSON:
 *   1. OPENROUTER_MODELS / OPENROUTER_VISION_MODELS (env, in order), else defaults
 *   2. free models discovered live from OpenRouter's /models list (cached 6 h)
 *   3. `openrouter/free` — OpenRouter's own router over whatever is free right now
 * A model that answers 429/404/"no endpoints" is benched for a few minutes so
 * the next request skips it instantly. Bad JSON or a weak draft → next model.
 */

const BASE_URL = 'https://openrouter.ai/api/v1';
const PER_MODEL_TIMEOUT_MS = 25_000;
/** Whole-chain budget — generate-email is a synchronous request behind a 120 s proxy. */
const DEFAULT_DEADLINE_MS = 80_000;
const MAX_MODELS_PER_CALL = 6;
const DISCOVERY_TTL_MS = 6 * 60 * 60 * 1000;
const BENCH_MS = 3 * 60 * 1000;

const DEFAULT_TEXT_MODELS = [
  'google/gemma-4-31b-it:free',
  'qwen/qwen3.8-27b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
];
const DEFAULT_VISION_MODELS = ['google/gemma-4-31b-it:free', 'qwen/qwen3.8-27b:free', 'google/gemma-4-26b-a4b-it:free'];
const FREE_ROUTER = 'openrouter/free';

export type Kind = 'text' | 'vision' | 'pdf';

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } };

export function isOpenRouterConfigured(): boolean {
  return Boolean(env.OPENROUTER_API_KEY);
}

/* ── Model discovery + benching ─────────────────────────────────── */

interface DiscoveredModel {
  id: string;
  vision: boolean;
  json: boolean;
  context: number;
}

let discovered: { at: number; models: DiscoveredModel[] } | null = null;
let discovering: Promise<DiscoveredModel[]> | null = null;
const benchedUntil = new Map<string, number>();
/**
 * The free-model DAILY quota is per account, shared by every free model, so
 * hopping models can't beat it. When OpenRouter says it's exhausted, stop
 * calling for a while and let the next engine (Gemini) / fallback answer fast.
 */
let accountPausedUntil = 0;

/** Test hook. */
export function resetOpenRouterState(): void {
  discovered = null;
  discovering = null;
  benchedUntil.clear();
  accountPausedUntil = 0;
}

const NOT_FOR_WRITING = /safety|guard|embed|code|coder|lfm-2|-mini-|nano(?!-omni)/i;

async function discoverFreeModels(): Promise<DiscoveredModel[]> {
  if (discovered && Date.now() - discovered.at < DISCOVERY_TTL_MS) return discovered.models;
  discovering ??= (async () => {
    try {
      const res = await fetch(`${BASE_URL}/models`, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        data?: Array<{
          id: string;
          context_length?: number;
          pricing?: { prompt?: string; completion?: string };
          architecture?: { input_modalities?: string[] };
          supported_parameters?: string[];
        }>;
      };
      const models = (body.data ?? [])
        .filter((m) => m.id.endsWith(':free') || (m.pricing?.prompt === '0' && m.pricing?.completion === '0'))
        .filter((m) => m.id !== FREE_ROUTER && !NOT_FOR_WRITING.test(m.id))
        .map((m) => ({
          id: m.id,
          vision: Boolean(m.architecture?.input_modalities?.includes('image')),
          json: Boolean(m.supported_parameters?.some((p) => p === 'response_format' || p === 'structured_outputs')),
          context: m.context_length ?? 0,
        }))
        .sort((a, b) => Number(b.json) - Number(a.json) || b.context - a.context);
      discovered = { at: Date.now(), models };
      return models;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'OpenRouter model discovery failed — using configured list');
      discovered = { at: Date.now() - DISCOVERY_TTL_MS + 5 * 60 * 1000, models: discovered?.models ?? [] };
      return discovered.models;
    } finally {
      discovering = null;
    }
  })();
  return discovering;
}

function listFromEnv(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function candidateModels(kind: Kind): Promise<string[]> {
  const configured =
    kind === 'text'
      ? listFromEnv(env.OPENROUTER_MODELS)
      : listFromEnv(env.OPENROUTER_VISION_MODELS).length
        ? listFromEnv(env.OPENROUTER_VISION_MODELS)
        : listFromEnv(env.OPENROUTER_MODELS);
  const base = configured.length ? configured : kind === 'text' ? DEFAULT_TEXT_MODELS : DEFAULT_VISION_MODELS;
  const live = (await discoverFreeModels()).filter((m) => (kind === 'vision' ? m.vision : true)).map((m) => m.id);
  const now = Date.now();
  const ordered = [...new Set([...base, ...live.slice(0, 6), FREE_ROUTER])];
  const fresh = ordered.filter((id) => (benchedUntil.get(id) ?? 0) <= now);
  // If everything is benched, still try the router rather than giving up.
  return (fresh.length ? fresh : [FREE_ROUTER]).slice(0, MAX_MODELS_PER_CALL);
}

/* ── One call, many models ──────────────────────────────────────── */

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly bench: boolean,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

async function callModel(model: string, parts: ContentPart[], kind: Kind, temperature: number, timeoutMs: number) {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: parts }],
    temperature,
    max_tokens: 2500,
    response_format: { type: 'json_object' },
    // Reasoning models: think if you must, but don't bill us the thoughts in `content`.
    reasoning: { exclude: true },
  };
  if (kind === 'pdf') body.plugins = [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }];

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': env.CLIENT_URL,
        'X-Title': 'GetHired',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new OpenRouterError(`network/timeout: ${err instanceof Error ? err.message : String(err)}`, null, false);
  }

  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number };
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> }; error?: { message?: string } }>;
  };
  if (!res.ok || json.error) {
    const status = res.ok ? (json.error?.code ?? null) : res.status;
    const msg = json.error?.message ?? `HTTP ${res.status}`;
    // 401/402 = key/credits problem (every model will fail the same way).
    if (status === 401 || status === 402) throw new OpenRouterError(`${status}: ${msg}`, status, false);
    if (status === 429 && /per.?day|daily|free-models-per-day/i.test(msg)) {
      accountPausedUntil = Date.now() + 60 * 60 * 1000;
      throw new OpenRouterError(`daily free quota reached: ${msg}`, 429, false);
    }
    const bench = status === 429 || status === 404 || status === 503 || /no endpoints|not a valid model|rate/i.test(msg);
    throw new OpenRouterError(`${status ?? '?'}: ${msg}`, status, bench);
  }
  const choice = json.choices?.[0];
  if (choice?.error?.message) throw new OpenRouterError(choice.error.message, null, true);
  const content = choice?.message?.content;
  const text = Array.isArray(content) ? content.map((c) => c.text ?? '').join('') : (content ?? '');
  if (!text.trim()) throw new OpenRouterError('empty response', null, false);
  return text;
}

/** Strip reasoning blocks / fences and return the first JSON object in the text. */
export function extractJson(raw: string): unknown {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/```(?:json)?/gi, ' ');
  const candidate = findFirstJsonObject(cleaned);
  if (!candidate) throw new Error('no JSON object in response');
  return JSON.parse(candidate);
}

export interface ChainOptions<T> {
  parts: ContentPart[];
  kind: Kind;
  temperature?: number;
  /** Parse + validate; throw to reject this model's answer. */
  parse: (raw: string) => T;
  /** Optional quality gate: return a reason to try the next model. */
  judge?: (value: T) => string | null;
  deadlineMs?: number;
  label: string;
}

export async function runChain<T>(opts: ChainOptions<T>): Promise<{ value: T; model: string }> {
  if (!isOpenRouterConfigured()) throw new Error('OPENROUTER_API_KEY is not set');
  if (Date.now() < accountPausedUntil) throw new Error('OpenRouter daily free quota reached — skipping');
  const deadline = Date.now() + (opts.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const models = await candidateModels(opts.kind);
  const failures: string[] = [];
  let fallback: { value: T; model: string } | null = null;

  for (const model of models) {
    const left = deadline - Date.now();
    if (left < 4_000) break;
    try {
      const raw = await callModel(model, opts.parts, opts.kind, opts.temperature ?? 0.2, Math.min(PER_MODEL_TIMEOUT_MS, left));
      const value = opts.parse(raw);
      const problem = opts.judge?.(value) ?? null;
      if (problem) {
        failures.push(`${model}: ${problem}`);
        fallback ??= { value, model }; // usable, just not great — keep as last resort
        continue;
      }
      logger.info({ task: opts.label, model, tried: failures.length + 1 }, 'OpenRouter call succeeded');
      return { value, model };
    } catch (err) {
      const e = err as OpenRouterError;
      failures.push(`${model}: ${e.message?.slice(0, 160)}`);
      if (e instanceof OpenRouterError && e.bench) benchedUntil.set(model, Date.now() + BENCH_MS);
      if (e instanceof OpenRouterError && (e.status === 401 || e.status === 402)) break;
      if (Date.now() < accountPausedUntil) break;
    }
  }
  if (fallback) {
    logger.warn({ task: opts.label, failures }, 'OpenRouter: using best available draft');
    return fallback;
  }
  logger.warn({ task: opts.label, failures }, 'OpenRouter: every model failed');
  throw new Error(`OpenRouter ${opts.label} failed on ${failures.length} model(s): ${failures.join(' | ')}`);
}

/* ── Engine operations ──────────────────────────────────────────── */

const text = (t: string): ContentPart => ({ type: 'text', text: t });

export async function extractJobImageOR(buffer: Buffer, mimeType: string): Promise<{ extraction: JobExtraction; rawText: string }> {
  let rawText = '';
  const { value } = await runChain({
    label: 'extract-image',
    kind: 'vision',
    temperature: 0.1,
    parts: [text(EXTRACTION_PROMPT), { type: 'image_url', image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}` } }],
    parse: (raw) => {
      rawText = raw;
      return parseExtractionJson(raw.replace(/<think>[\s\S]*?<\/think>/gi, ' '));
    },
    judge: (x) => (!x.company && !x.role && x.hrEmails.length === 0 ? 'read nothing' : null),
  });
  return { extraction: value, rawText };
}

export async function extractJobTextOR(raw: string): Promise<{ extraction: JobExtraction }> {
  const { value } = await runChain({
    label: 'extract-text',
    kind: 'text',
    temperature: 0.1,
    parts: [text(`${TEXT_EXTRACTION_PROMPT}\n\nJOB POSTING TEXT:\n${raw.slice(0, 20000)}`)],
    parse: (r) => parseExtractionJson(r.replace(/<think>[\s\S]*?<\/think>/gi, ' ')),
  });
  return { extraction: value };
}

export async function analyzeMatchOR(input: MatchAnalysisInput): Promise<JobMatch> {
  const { value } = await runChain({
    label: 'match',
    kind: 'text',
    temperature: 0.2,
    deadlineMs: 40_000,
    parts: [text(buildMatchPrompt(input))],
    parse: (r) => {
      const parsed = matchAnalysisSchema.safeParse(extractJson(r));
      if (!parsed.success) throw new Error(`schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return parsed.data;
    },
  });
  return value;
}

export async function generateEmailOR(input: OutreachEmailInput): Promise<RawEmailDraft & { model: string }> {
  const { value, model } = await runChain({
    label: 'email',
    kind: 'text',
    temperature: 0.7,
    parts: [text(buildEmailPrompt(input))],
    parse: (r) => {
      const parsed = emailDraftSchema.safeParse(extractJson(r));
      if (!parsed.success) throw new Error(`schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return parsed.data;
    },
    judge: (d) => draftQualityProblem(d, input),
  });
  return { ...value, model };
}

export async function extractResumeOR(input: { pdf?: Buffer; text?: string }, today: Date = new Date()): Promise<ResumeAiResult> {
  const mode = input.text ? (input.pdf ? 'both' : 'text') : 'pdf';
  // Text is the reliable path on free models; the PDF goes along only when the text layer is unusable.
  const usePdf = !input.text && Boolean(input.pdf);
  const parts: ContentPart[] = [text(RESUME_PROMPT(today.toISOString().slice(0, 10), usePdf ? 'pdf' : mode === 'both' ? 'text' : mode))];
  if (input.text) parts.push(text(`EXTRACTED TEXT (exact strings; reading order may be imperfect):\n${input.text.slice(0, 30000)}`));
  if (usePdf && input.pdf) {
    parts.push({ type: 'file', file: { filename: 'resume.pdf', file_data: `data:application/pdf;base64,${input.pdf.toString('base64')}` } });
  }
  const { value } = await runChain({
    label: 'resume',
    kind: usePdf ? 'pdf' : 'text',
    temperature: 0.2,
    deadlineMs: 60_000,
    parts,
    parse: (r) => {
      const parsed = resumeAiSchema.safeParse(extractJson(r));
      if (!parsed.success) throw new Error(`schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return parsed.data;
    },
    judge: (v) => (!v.fullName && v.skills.length === 0 ? 'empty result' : null),
  });
  return value;
}
