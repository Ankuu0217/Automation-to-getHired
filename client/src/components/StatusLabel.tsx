import { cn } from '@/lib/utils';

import { Mono } from './Mono';

export type StatusKind = 'applied' | 'hr_screen' | 'interview' | 'offer' | 'rejected' | 'ghosted' | 'sent' | 'opened' | 'replied' | 'bounced' | 'draft' | 'queued';

interface StatusLabelProps {
  status: StatusKind;
  className?: string;
}

const DOT_COLOR: Record<StatusKind, string> = {
  applied: 'bg-text-3',
  hr_screen: 'bg-text-3',
  interview: 'bg-text-3',
  offer: 'bg-ok',
  rejected: 'bg-danger',
  ghosted: 'bg-text-3',
  sent: 'bg-text-3',
  opened: 'bg-cyan',
  replied: 'bg-ok',
  bounced: 'bg-danger',
  draft: 'bg-text-3',
  queued: 'bg-cyan',
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
    <div className={cn('inline-flex items-center gap-2', className)}>
      <span className={cn('size-1.5 rounded-full', DOT_COLOR[status])} />
      <Mono size="xs" color="ash">
        {LABEL[status]}
      </Mono>
    </div>
  );
}
