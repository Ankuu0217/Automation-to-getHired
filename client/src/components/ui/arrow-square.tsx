import { ArrowDown, ArrowRight } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';

/*
 * The signature lime arrow square — the only place the accent appears as
 * a fill. Ink arrow on lime. `md` (40px, radius 10) is the app scale;
 * `lg` (56px, radius 14) is the landing hero scale.
 *
 * When it sits beside a labeled Button/link that performs the same
 * action, pass `decorative`: with a handler it stays clickable for mouse
 * users but leaves the accessibility tree and tab order; without any
 * handler it renders as a plain visual span.
 */
const baseClass =
  'group inline-flex shrink-0 items-center justify-center bg-lime text-ink transition duration-200 ease-out hover:-translate-y-0.5 hover:opacity-90 active:translate-y-0 active:opacity-80 disabled:pointer-events-none disabled:opacity-50';

const SIZE_CLASS = {
  md: 'size-10 rounded-btn',
  lg: 'size-14 rounded-arrow',
} as const;

interface ArrowSquareProps {
  'aria-label'?: string;
  to?: string;
  onClick?: React.MouseEventHandler;
  direction?: 'right' | 'down';
  size?: keyof typeof SIZE_CLASS;
  decorative?: boolean;
  disabled?: boolean;
  className?: string;
}

function ArrowSquare({
  to,
  onClick,
  direction = 'right',
  size = 'md',
  decorative = false,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: ArrowSquareProps) {
  const Icon = direction === 'down' ? ArrowDown : ArrowRight;
  const icon = (
    <Icon
      className={cn(
        'transition-transform duration-200 ease-out',
        size === 'lg' ? 'size-5' : 'size-4',
        direction === 'right' && 'group-hover:translate-x-0.5',
        direction === 'down' && 'group-hover:translate-y-0.5',
      )}
      strokeWidth={1.5}
    />
  );
  const classes = cn(baseClass, SIZE_CLASS[size], className);

  if (decorative && !to && !onClick) {
    return (
      <span aria-hidden className={cn(classes, 'focus-ring')}>
        {icon}
      </span>
    );
  }

  const hidden = decorative
    ? ({ 'aria-hidden': true, tabIndex: -1 } as const)
    : ({ 'aria-label': ariaLabel } as const);

  if (to && !disabled) {
    return (
      <Link to={to} {...hidden} className={cn('focus-ring', classes)}>
        {icon}
      </Link>
    );
  }
  return (
    <button
      type="button"
      {...hidden}
      onClick={onClick}
      disabled={disabled}
      className={cn('focus-ring', classes)}
    >
      {icon}
    </button>
  );
}

/* Kept for EmptyState's inline square; mirrors baseClass at md scale. */
const arrowSquareClass = cn(baseClass, SIZE_CLASS.md, 'focus-ring');

export { ArrowSquare, arrowSquareClass };
