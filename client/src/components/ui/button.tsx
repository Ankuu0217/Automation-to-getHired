import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-func font-sans text-sm font-medium transition-quick disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-[0.92] active:opacity-[0.85]',
        destructive: 'bg-danger text-pure hover:bg-danger/90 active:bg-danger/80',
        outline:
          'border border-border-strong bg-transparent text-text-1 hover:bg-pure/[0.06] active:bg-pure/[0.04]',
        secondary:
          'border border-border-strong bg-surface-2 text-text-1 shadow-inset-hairline hover:bg-pure/[0.08] active:bg-pure/[0.04]',
        ghost: 'text-text-2 hover:bg-surface-2 hover:text-text-1 active:bg-surface',
        link: 'text-text-1 underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3',
        lg: 'h-11 px-5 text-base',
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
