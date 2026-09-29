import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { Mono } from '@/components/Mono';
import { Button } from '@/components/ui/button';
import { ApiRequestError, getAiHealth, type AiHealth } from '@/lib/api';

/** Live check of the AI engines behind screenshot reading and email writing. */
export function AiHealthCard() {
  const check = useMutation({ mutationFn: getAiHealth });
  const data: AiHealth | undefined = check.data;
  const key = data?.openrouter.key;

  return (
    <div className="space-y-3 rounded-card border border-graphite bg-ink-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Mono size="xs" color="fog">AI engines</Mono>
          <p className="mt-1 font-sans text-sm text-text-2-dark">
            Reads screenshots and writes your emails. Run a check if extraction falls back to manual entry.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => check.mutate()} disabled={check.isPending}>
          {check.isPending && <Loader2 className="size-4 animate-spin" />}
          {check.isPending ? 'Checking…' : 'Run check'}
        </Button>
      </div>

      {check.isError && (
        <p className="font-sans text-sm text-danger">
          {check.error instanceof ApiRequestError ? check.error.message : 'Check failed.'}
        </p>
      )}

      {data && (
        <div className="space-y-3 font-sans text-sm">
          <div>
            <Mono size="xs" color={data.openrouter.configured ? 'pure' : 'warn'}>
              OpenRouter {data.openrouter.configured ? '' : '· not configured (set OPENROUTER_API_KEY)'}
            </Mono>
            {key && 'error' in key && <p className="mt-1 text-danger">Key problem: {key.error}</p>}
            {key && !('error' in key) && (
              <p className="mt-1 text-text-2-dark">
                Key OK{key.freeTier ? ' · free tier (50 free-model requests/day until you add $10 credit)' : ''}
                {typeof key.limitRemaining === 'number' ? ` · $${key.limitRemaining.toFixed(2)} left` : ''}
              </p>
            )}
            {[...data.openrouter.vision.map((m) => ({ ...m, kind: 'vision' })), ...data.openrouter.text.map((m) => ({ ...m, kind: 'text' }))].map((m) => (
              <p key={`${m.kind}-${m.model}`} className="mt-1 flex flex-wrap gap-x-2 text-xs">
                <span className={m.ok ? 'text-ok' : 'text-danger'}>{m.ok ? '●' : '○'}</span>
                <span className="text-bone">{m.model}</span>
                <span className="text-text-3-dark">{m.kind} · {(m.ms / 1000).toFixed(1)}s</span>
                {m.error && <span className="text-danger">{m.error}</span>}
              </p>
            ))}
          </div>
          <div>
            <Mono size="xs" color={data.gemini.configured ? 'pure' : 'fog'}>
              Gemini {data.gemini.configured ? `· ${data.gemini.model ?? ''}` : '· not configured'}
            </Mono>
            {data.gemini.configured && (
              <p className={`mt-1 text-xs ${data.gemini.ok ? 'text-ok' : 'text-danger'}`}>
                {data.gemini.ok ? `Working · ${((data.gemini.ms ?? 0) / 1000).toFixed(1)}s` : data.gemini.error ?? 'Not responding'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
