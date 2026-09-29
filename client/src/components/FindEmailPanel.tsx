import type { EmailSuggestion } from '@jobmail/shared';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { useState } from 'react';

import { Mono } from '@/components/Mono';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiRequestError, findRecruiterEmail } from '@/lib/api';
import { cn } from '@/lib/utils';

const SOURCE_LABEL: Record<EmailSuggestion['source'], string> = { hunter: 'Verified source', pattern: 'Name pattern', role: 'Hiring mailbox' };

/** "No email in the post" → suggest likely recruiter addresses; one click fills the field. */
export function FindEmailPanel({
  jobId,
  company,
  hrName,
  onPick,
}: {
  jobId: string;
  company: string;
  hrName: string;
  onPick: (email: string) => void;
}) {
  const [domain, setDomain] = useState('');
  const find = useMutation({
    mutationFn: () => findRecruiterEmail(jobId, { company: company || undefined, hrName: hrName || undefined, domain: domain || undefined }),
  });
  const data = find.data;

  return (
    <div className="space-y-3 rounded-card border border-graphite bg-ink-2 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <Mono size="xs" color="fog">COMPANY WEBSITE — OPTIONAL</Mono>
          <Input id="finder-domain" placeholder={company ? `we'll guess from “${company}”` : 'company.com'} value={domain} onChange={(e) => setDomain(e.target.value)} />
        </div>
        <Button variant="outline" onClick={() => find.mutate()} disabled={find.isPending || (!company && !domain)}>
          {find.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Find recruiter email
        </Button>
      </div>
      {!hrName && <Mono size="xs" color="fog">Tip: add the recruiter’s name above for personal address guesses.</Mono>}
      {find.isError && (
        <p className="font-sans text-sm text-danger">{find.error instanceof ApiRequestError ? find.error.message : 'Search failed.'}</p>
      )}
      {data && data.suggestions.length === 0 && (
        <p className="font-sans text-sm text-text-2-dark">No mail server found for that company. Type its website domain (e.g. sisgain.com) and search again.</p>
      )}
      {data && data.suggestions.length > 0 && (
        <div className="space-y-2">
          <Mono size="xs" color="fog">Suggestions for {data.domains.join(', ')} — pick one, then double-check it</Mono>
          {data.suggestions.map((s) => (
            <button
              key={s.email}
              type="button"
              onClick={() => onPick(s.email)}
              className="focus-ring flex w-full items-center gap-3 rounded-btn border border-graphite bg-ink px-3 py-2 text-left transition-quick hover:border-lime"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-paper">{s.email}</span>
              <Mono size="xs" color={s.source === 'hunter' ? 'cyan' : 'fog'}>{SOURCE_LABEL[s.source]}</Mono>
              <span className={cn('font-mono text-[11px] tabular-nums', s.confidence >= 0.4 ? 'text-ok' : 'text-text-3-dark')}>{Math.round(s.confidence * 100)}%</span>
            </button>
          ))}
          <p className="font-sans text-xs text-text-3-dark">Guesses aren’t verified. If one bounces, GetHired flags it and stops follow-ups automatically.</p>
        </div>
      )}
    </div>
  );
}
