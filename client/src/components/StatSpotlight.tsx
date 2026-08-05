import { cn } from '@/lib/utils';

interface StatSpotlightProps {
  label: string;
  value: string;
  description: string;
  className?: string;
}

export function StatSpotlight({ label, value, description, className }: StatSpotlightProps) {
  return (
    <div
      className={cn(
        'flex flex-col justify-between rounded-card bg-silver p-8 text-ink',
        className,
      )}
    >
      <span className="font-mono text-[11px] uppercase tracking-[0.16px] opacity-70">{label}</span>
      <div className="mt-6">
        <span className="font-sans text-[38px] font-normal leading-[0.9]">{value}</span>
        <p className="mt-2 font-sans text-base font-normal leading-[1.5] opacity-80">{description}</p>
      </div>
    </div>
  );
}
