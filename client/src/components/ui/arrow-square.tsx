import { ArrowDown, ArrowRight } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';

/*
 * The signature lime arrow square — the accent as a fill.
 *
 * `variant`:
 *  - 'lime' (default): lime fill, ink arrow, with its own hover lift/fade.
 *    This is every app-scale usage and is left byte-identical.
 *  - 'inverted': ink fill, lime arrow AT REST, colour-inverting to lime fill /
 *    ink arrow as ONE unit with the labelled control it sits beside. Drive the
 *    pair from a shared `group/cta` scope: the square inverts on
 *    `group-hover/cta` (hover-capable pointers only, so it never sticks after a
 *    tap) and on `group-focus-within/cta`, so keyboard focus on the sibling
 *    earns the identical affordance. 320ms expo-out, on background-color +
 *    color only — never `transition: all`.
 *
 * `size`: `md` (40px, r10) app scale; `lg` (56px, r14) landing hero scale.
 * `decorative`: with a handler it stays clickable for mouse users but leaves
 * the accessibility tree and tab order; without any handler it renders as a
 * plain visual span.
 */
const COMMON =
  'inline-flex shrink-0 items-center justify-center disabled:pointer-events-none disabled:opacity-50';

const VARIANT_CLASS = {
  lime: 'group bg-lime text-ink transition duration-200 ease-out hover:-translate-y-0.5 hover:opacity-90 active:translate-y-0 active:opacity-80',
  inverted:
    'bg-ink text-lime transition-[background-color,color] [transition-duration:320ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] group-focus-within/cta:bg-lime group-focus-within/cta:text-ink hover-hover:group-hover/cta:bg-lime hover-hover:group-hover/cta:text-ink',
} as const;

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
  variant?: keyof typeof VARIANT_CLASS;
  decorative?: boolean;
  disabled?: boolean;
  className?: string;
}

function ArrowSquare({
  to,
  onClick,
  direction = 'right',
  size = 'md',
  variant = 'lime',
  decorative = false,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: ArrowSquareProps) {
  const Icon = direction === 'down' ? ArrowDown : ArrowRight;
  /* The arrow nudges on the same scope/curve as its square's inversion. */
  const iconMotion =
    variant === 'inverted'
      ? cn(
          'transition-transform [transition-duration:320ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]',
          direction === 'right' &&
            'group-focus-within/cta:translate-x-[2px] hover-hover:group-hover/cta:translate-x-[2px]',
          direction === 'down' &&
            'group-focus-within/cta:translate-y-[2px] hover-hover:group-hover/cta:translate-y-[2px]',
        )
      : cn(
          'transition-transform duration-200 ease-out',
          direction === 'right' && 'group-hover:translate-x-0.5',
          direction === 'down' && 'group-hover:translate-y-0.5',
        );
  const icon = (
    <Icon className={cn(iconMotion, size === 'lg' ? 'size-5' : 'size-4')} strokeWidth={1.5} />
  );
  const classes = cn(COMMON, VARIANT_CLASS[variant], SIZE_CLASS[size], className);

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
      // A decorative square is aria-hidden/tabindex -1; keep mouse clicks from
      // focusing it so `group-focus-within/cta` never sticks the inversion on
      // after a tap. Keyboard focus lands on the labelled sibling instead.
      onMouseDown={decorative ? (e) => e.preventDefault() : undefined}
      onClick={onClick}
      disabled={disabled}
      className={cn('focus-ring', classes)}
    >
      {icon}
    </button>
  );
}

/* Kept for inline squares that mirror baseClass at md scale (lime variant). */
const arrowSquareClass = cn(COMMON, VARIANT_CLASS.lime, SIZE_CLASS.md, 'focus-ring');

export { ArrowSquare, arrowSquareClass };
