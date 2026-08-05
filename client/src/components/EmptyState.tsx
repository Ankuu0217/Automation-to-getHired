import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';

/*
 * The house empty-state: Aspekta 36px headline (single weight, period-
 * terminated), mono caption, optional lime arrow-square CTA.
 */
interface EmptyStateProps {
  headline: React.ReactNode;
  description?: React.ReactNode;
  action?: { to: string; label: string };
  className?: string;
}

export function EmptyState({ headline, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('rounded-card border border-graphite bg-ink-2 px-6 py-10', className)}>
      <p className="font-sans text-heading font-normal text-paper">{headline}</p>
      {description && (
        <p className="mt-3 font-mono text-[13px] font-normal uppercase leading-relaxed tracking-[-0.02em] text-text-2-dark">
          {description}
        </p>
      )}
      {action && (
        <Link
          to={action.to}
          className="focus-ring group mt-6 inline-flex items-center gap-3 rounded-btn"
        >
          <span className="font-mono text-[13px] uppercase tracking-[-0.02em] text-paper">
            {action.label}
          </span>
          <span
            aria-hidden
            className="inline-flex size-10 items-center justify-center rounded-btn bg-lime text-ink transition-quick group-hover:opacity-90"
          >
            <ArrowRight className="size-4" strokeWidth={1.5} />
          </span>
        </Link>
      )}
    </div>
  );
}
