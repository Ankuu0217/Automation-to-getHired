import { Link } from 'react-router-dom';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The house empty-state: serif headline with an italic word (use <em> in
 * the headline node), quiet description, optional CTA.
 */
interface EmptyStateProps {
  headline: React.ReactNode;
  description?: React.ReactNode;
  action?: { to: string; label: string };
  className?: string;
}

export function EmptyState({ headline, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('rounded-card border border-border bg-surface px-6 py-10', className)}>
      <p className="font-display text-[38px] font-normal leading-[0.9] text-text-1">{headline}</p>
      {description && (
        <p className="mt-2 font-sans text-base font-normal text-text-2">{description}</p>
      )}
      {action && (
        <Link to={action.to} className={cn(buttonVariants({ size: 'sm' }), 'mt-5')}>
          {action.label}
          <span aria-hidden>→</span>
        </Link>
      )}
    </div>
  );
}
