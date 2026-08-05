import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 font-sans text-xs font-normal transition-quick',
  {
    variants: {
      variant: {
        default:
          'border-graphite bg-ink-3 text-paper',
        secondary: 'border-text-3-dark-dark bg-ink-3 text-text-2-dark',
        outline: 'border-text-3-dark-dark text-text-2-dark',
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
