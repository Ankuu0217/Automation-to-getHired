import { cn } from '@/lib/utils';

export type StampStatus =
  | 'sent'
  | 'queued'
  | 'opened'
  | 'replied'
  | 'bounced'
  | 'draft'
  | 'ai-drafted';

interface StampConfig {
  label: string;
  color: string;
  tilt?: number;
  fill?: string;
}

const CONFIG: Record<StampStatus, StampConfig> = {
  sent: { label: 'SENT', color: 'text-cyan' },
  queued: { label: 'QUEUED', color: 'text-warn' },
  opened: { label: 'OPENED', color: 'text-ok' },
  replied: { label: 'REPLIED', color: 'text-ok' },
  bounced: { label: 'RETURNED', color: 'text-danger' },
  draft: { label: 'DRAFT', color: 'text-text-3' },
  'ai-drafted': {
    label: 'AI DRAFTED',
    color: 'text-pure',
    tilt: -2,
    fill: 'bg-pure/10',
  },
};

function stableTilt(seed: string | number) {
  let hash = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) % 1000;
  }
  // Range -3deg to +1.5deg.
  return -3 + (hash / 1000) * 4.5;
}

interface StampProps {
  status: StampStatus;
  seed?: string | number;
  className?: string;
}

export function Stamp({ status, seed = status, className }: StampProps) {
  const config = CONFIG[status];
  const tilt = config.tilt ?? stableTilt(seed);
  const label = status === 'replied' ? `● ${config.label}` : config.label;

  return (
    <span
      className={cn(
        'stamp inline-block transition-opacity duration-150',
        config.color,
        config.fill,
        className,
      )}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      {label}
    </span>
  );
}
