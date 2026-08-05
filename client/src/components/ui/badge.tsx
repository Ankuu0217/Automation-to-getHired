import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 font-sans text-xs font-normal transition-quick',
  {
    variants: {
      variant: {
        /* hairline tags — status is carried by border + text, never fills */
        default: 'border-graphite bg-transparent text-paper',
        secondary: 'border-graphite bg-transparent text-text-2-dark',
        outline: 'border-graphite bg-transparent text-text-2-dark',
        success: 'border-ok/40 bg-transparent text-ok',
        warning: 'border-warn/40 bg-transparent text-warn',
        destructive: 'border-danger/40 bg-transparent text-danger',
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
