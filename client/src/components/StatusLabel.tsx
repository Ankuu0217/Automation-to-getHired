import { cn } from '@/lib/utils';

import { Mono } from './Mono';

export type StatusKind = 'applied' | 'hr_screen' | 'interview' | 'offer' | 'rejected' | 'ghosted' | 'sent' | 'opened' | 'replied' | 'bounced' | 'draft' | 'queued';

interface StatusLabelProps {
  status: StatusKind;
  className?: string;
}

/*
 * One signal logic across both status families, on the rationed palette:
 * solid lime = won, hollow lime = engaged, amber = waiting/in-tension,
 * red = lost, neutral solid = in flight, neutral faint = inactive
 * (draft solid, ghosted hollow). 6px dots + mono labels.
 */
const DOT_COLOR: Record<StatusKind, string> = {
  applied: 'bg-text-2-dark',
  hr_screen: 'border border-lime bg-transparent',
  interview: 'bg-warn',
  offer: 'bg-ok',
  rejected: 'bg-danger',
  ghosted: 'border border-text-3-dark bg-transparent',
  sent: 'bg-text-2-dark',
  opened: 'border border-lime bg-transparent',
  replied: 'bg-ok',
  bounced: 'bg-danger',
  draft: 'bg-text-3-dark',
  queued: 'border border-warn bg-transparent',
};

const LABEL: Record<StatusKind, string> = {
  applied: 'Applied',
  hr_screen: 'HR Screen',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  ghosted: 'Ghosted',
  sent: 'Sent',
  opened: 'Opened',
  replied: 'Replied',
  bounced: 'Bounced',
  draft: 'Draft',
  queued: 'Queued',
};

export function StatusLabel({ status, className }: StatusLabelProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className={cn('size-1.5 rounded-full', DOT_COLOR[status])} />
      <Mono size="xs" color="ash">
        {LABEL[status]}
      </Mono>
    </span>
  );
}
