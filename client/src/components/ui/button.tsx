import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/*
 * Lab-instrument buttons: Roboto Mono uppercase labels, opposite-surface
 * fills (white on dark canvas), ghost hairline secondaries. Danger is a
 * ghost border + text, never a large fill.
 */
const buttonVariants = cva(
  'focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-btn font-mono text-[13px] font-normal uppercase tracking-[-0.02em] transition-quick disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-[0.92] active:opacity-[0.85]',
        destructive:
          'border border-danger/40 bg-transparent text-danger hover:bg-danger/10 active:bg-danger/[0.06]',
        outline:
          'border border-graphite bg-transparent text-paper hover:border-text-3-dark hover:bg-paper/[0.04] active:bg-paper/[0.02]',
        secondary:
          'border border-graphite bg-transparent text-paper hover:border-text-3-dark hover:bg-paper/[0.04] active:bg-paper/[0.02]',
        ghost: 'text-text-2-dark hover:bg-ink-3 hover:text-paper active:bg-ink-2',
        link: 'text-paper underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4',
        sm: 'h-8 px-3',
        lg: 'h-11 px-5 text-[14px]',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
