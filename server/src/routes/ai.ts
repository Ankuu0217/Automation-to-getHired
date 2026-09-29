import { Router } from 'express';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { probeOpenRouter } from '../services/ai/openrouter';
import { getAIProvider } from '../services/ai/provider';
import { GoogleGenAI } from '@google/genai';

/**
 * GET /api/v1/ai/health — live check of every AI engine this server can use:
 * OpenRouter key status + a tiny JSON call per candidate model, and Gemini.
 * Answers "why did extraction fall back to manual?" without reading server logs.
 */
export const aiRouter = Router();
aiRouter.use(requireAuth);

aiRouter.get('/health', async (_req, res, next) => {
  try {
    const geminiProbe = async () => {
      if (!env.GEMINI_API_KEY) return { configured: false as const };
      const t0 = Date.now();
      try {
        const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, httpOptions: { timeout: 20_000 } });
        const r = await client.models.generateContent({
          model: env.GEMINI_TEXT_MODEL || env.GEMINI_MODEL,
          contents: 'Reply with the JSON object {"ok": true} and nothing else.',
          config: { responseMimeType: 'application/json' },
        });
        return { configured: true as const, ok: /"ok"\s*:\s*true/.test(r.text ?? ''), ms: Date.now() - t0, model: env.GEMINI_TEXT_MODEL || env.GEMINI_MODEL };
      } catch (err) {
        return { configured: true as const, ok: false, ms: Date.now() - t0, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
      }
    };
    const [openrouter, gemini] = await Promise.all([probeOpenRouter(), geminiProbe()]);
    res.json({ provider: getAIProvider().name, openrouter, gemini, ocrEnabled: env.OCR_ENABLED });
  } catch (err) {
    next(err);
  }
});
