import { ArrowDown, ArrowRight } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';

/*
 * The signature 40x40 lime arrow square — the only place the accent
 * appears as a fill. Ink arrow on lime, radius 8px.
 *
 * When it sits beside a labeled Button/link that performs the same
 * action, pass `decorative`: the square stays clickable for mouse users
 * but leaves the accessibility tree and tab order, so the paired
 * control remains the single announced action.
 */
const arrowSquareClass =
  'focus-ring inline-flex size-10 shrink-0 items-center justify-center rounded-btn bg-lime text-ink transition-quick hover:opacity-90 active:opacity-80 disabled:pointer-events-none disabled:opacity-50';

interface ArrowSquareProps {
  'aria-label'?: string;
  to?: string;
  onClick?: React.MouseEventHandler;
  direction?: 'right' | 'down';
  decorative?: boolean;
  disabled?: boolean;
  className?: string;
}

function ArrowSquare({
  to,
  onClick,
  direction = 'right',
  decorative = false,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: ArrowSquareProps) {
  const Icon = direction === 'down' ? ArrowDown : ArrowRight;
  const hidden = decorative
    ? ({ 'aria-hidden': true, tabIndex: -1 } as const)
    : ({ 'aria-label': ariaLabel } as const);

  if (to && !disabled) {
    return (
      <Link to={to} {...hidden} className={cn(arrowSquareClass, className)}>
        <Icon className="size-4" strokeWidth={1.5} />
      </Link>
    );
  }
  return (
    <button
      type="button"
      {...hidden}
      onClick={onClick}
      disabled={disabled}
      className={cn(arrowSquareClass, className)}
    >
      <Icon className="size-4" strokeWidth={1.5} />
    </button>
  );
}

export { ArrowSquare, arrowSquareClass };
