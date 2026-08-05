import { cn } from '@/lib/utils';

import { Mono } from './Mono';

export type StatusKind = 'applied' | 'hr_screen' | 'interview' | 'offer' | 'rejected' | 'ghosted' | 'sent' | 'opened' | 'replied' | 'bounced' | 'draft' | 'queued';

interface StatusLabelProps {
  status: StatusKind;
  className?: string;
}

/*
 * One color logic across both status families:
 * cyan = in flight, iris = engaged, orchid = deep engagement,
 * warn = waiting, ok = won, danger = lost, gray = inactive
 * (draft solid, ghosted hollow).
 */
const DOT_COLOR: Record<StatusKind, string> = {
  applied: 'bg-cyan',
  hr_screen: 'bg-iris',
  interview: 'bg-orchid',
  offer: 'bg-ok',
  rejected: 'bg-danger',
  ghosted: 'border border-text-3 bg-transparent',
  sent: 'bg-cyan',
  opened: 'bg-iris',
  replied: 'bg-ok',
  bounced: 'bg-danger',
  draft: 'bg-text-3',
  queued: 'bg-warn',
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
