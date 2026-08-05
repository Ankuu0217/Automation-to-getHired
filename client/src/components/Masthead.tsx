import { cn } from '@/lib/utils';

function formatDateline(date = new Date()) {
  return date
    .toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    .toUpperCase();
}

interface MastheadProps {
  title: string;
  dispatchCount?: number;
  edition?: number;
  className?: string;
  children?: React.ReactNode;
}

export function Masthead({ title, dispatchCount, edition, className, children }: MastheadProps) {
  const parts: string[] = [];
  if (dispatchCount !== undefined) {
    parts.push(`${String(dispatchCount).padStart(4, '0')} LOGGED`);
  }
  parts.push(formatDateline());
  if (edition !== undefined) {
    parts.push(`EDITION Nº ${edition}`);
  }
  const dateline = parts.join(' · ');

  return (
    <header className={cn('pb-4', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="micro-label truncate">{dateline}</span>
        {children}
      </div>
      <h1 className="mt-1 font-display text-[22px] font-normal leading-tight text-pure">
        {title}
      </h1>
      <div className="rule-double mt-3" />
    </header>
  );
}
