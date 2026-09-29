import type { JobPostResponse } from '@jobmail/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Mono } from '@/components/Mono';
import { Button } from '@/components/ui/button';
import { ApiRequestError, tailorJob } from '@/lib/api';

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied.');
  } catch {
    toast.error('Copy failed — select the text instead.');
  }
}

/** Résumé tailored to this posting: summary, re-phrased bullets, keyword gaps. */
export function TailorCard({ job }: { job: JobPostResponse }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(Boolean(job.tailoring));
  const tailor = useMutation({
    mutationFn: () => tailorJob(job.id),
    onSuccess: (data) => {
      queryClient.setQueryData(['job', job.id], (old: { job: JobPostResponse } | undefined) => ({ job: { ...(old?.job ?? job), tailoring: data.job.tailoring } }));
      setOpen(true);
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : 'Could not tailor the résumé.'),
  });
  const t = tailor.data?.job.tailoring ?? job.tailoring;

  return (
    <div className="rounded-card border border-graphite bg-ink-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Mono size="xs" color="fog">Résumé for this job</Mono>
          <p className="mt-1 font-sans text-sm text-text-2-dark">
            A summary and bullets rewritten toward this posting, plus the keywords your résumé is missing.
          </p>
        </div>
        <div className="flex gap-2">
          {t && (
            <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'}</Button>
          )}
          <Button variant="outline" size="sm" onClick={() => tailor.mutate()} disabled={tailor.isPending}>
            {tailor.isPending ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            {t ? 'Regenerate' : 'Tailor my résumé'}
          </Button>
        </div>
      </div>

      {t && open && (
        <div className="mt-4 space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <Mono size="xs" color="pure">Professional summary</Mono>
              <button type="button" onClick={() => void copy(t.summary)} className="focus-ring inline-flex items-center gap-1 rounded-btn px-2 py-1 font-mono text-[11px] uppercase text-text-2-dark hover:text-paper">
                <Copy className="size-3" /> Copy
              </button>
            </div>
            <p className="mt-1 font-sans text-sm leading-relaxed text-bone">{t.summary}</p>
          </div>
          {t.highlights.length > 0 && (
            <div>
              <div className="flex items-center justify-between">
                <Mono size="xs" color="pure">Bullets to use</Mono>
                <button type="button" onClick={() => void copy(t.highlights.map((h) => `• ${h}`).join('\n'))} className="focus-ring inline-flex items-center gap-1 rounded-btn px-2 py-1 font-mono text-[11px] uppercase text-text-2-dark hover:text-paper">
                  <Copy className="size-3" /> Copy
                </button>
              </div>
              <ul className="mt-1 list-disc space-y-1 pl-5 font-sans text-sm text-bone">
                {t.highlights.map((h) => <li key={h}>{h}</li>)}
              </ul>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Mono size="xs" color="cyan">Already covered</Mono>
              <p className="mt-1 font-sans text-sm text-text-2-dark">{t.keywordsCovered.join(', ') || '—'}</p>
            </div>
            <div>
              <Mono size="xs" color="warn">Missing from your résumé</Mono>
              <p className="mt-1 font-sans text-sm text-text-2-dark">
                {t.keywordsMissing.length ? `${t.keywordsMissing.join(', ')} — add only what you’ve really used.` : 'Nothing important.'}
              </p>
            </div>
          </div>
          {t.source === 'basic' && <Mono size="xs" color="fog">AI was unavailable — this is a keyword-based version. Regenerate later for a rewrite.</Mono>}
        </div>
      )}
    </div>
  );
}
