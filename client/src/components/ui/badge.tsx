import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-sans text-xs font-normal transition-quick focus:outline-none',
  {
    variants: {
      variant: {
        default:
          'border-border bg-surface text-text-1',
        secondary: 'border-border-strong bg-surface-2 text-text-2',
        outline: 'border-border-strong text-text-2',
        success: 'border-ok/30 bg-ok/10 text-ok',
        warning: 'border-warn/30 bg-warn/10 text-warn',
        destructive: 'border-danger/30 bg-danger/10 text-danger',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
