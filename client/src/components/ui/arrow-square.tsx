import { ArrowDown, ArrowRight } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';

/*
 * The signature 40x40 lime arrow square — the only place the accent
 * appears as a fill. Ink arrow on lime, radius 8px.
 */
const arrowSquareClass =
  'focus-ring inline-flex size-10 shrink-0 items-center justify-center rounded-btn bg-lime text-ink transition-quick hover:opacity-90 active:opacity-80';

interface ArrowSquareProps {
  'aria-label': string;
  to?: string;
  onClick?: React.MouseEventHandler;
  direction?: 'right' | 'down';
  className?: string;
}

function ArrowSquare({
  to,
  onClick,
  direction = 'right',
  className,
  'aria-label': ariaLabel,
}: ArrowSquareProps) {
  const Icon = direction === 'down' ? ArrowDown : ArrowRight;
  if (to) {
    return (
      <Link to={to} aria-label={ariaLabel} className={cn(arrowSquareClass, className)}>
        <Icon className="size-4" strokeWidth={1.5} />
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(arrowSquareClass, className)}
    >
      <Icon className="size-4" strokeWidth={1.5} />
    </button>
  );
}

export { ArrowSquare, arrowSquareClass };
