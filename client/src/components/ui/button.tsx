import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] font-sans text-base font-normal transition-quick focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pure/40 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-pure text-void hover:opacity-92',
        destructive:
          'bg-danger text-pure hover:bg-danger/90',
        outline:
          'border border-pure bg-transparent text-pure hover:bg-pure/8',
        secondary:
          'bg-graphite text-pure hover:bg-steel',
        ghost: 'text-ash hover:text-pure hover:bg-graphite',
        link: 'text-pure underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-[18px] py-3',
        sm: 'h-9 rounded-[8px] px-3 py-2 text-sm',
        lg: 'h-12 rounded-[8px] px-6 text-base',
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
