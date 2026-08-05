import { ChevronDown } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/** Styled native select — fine for simple pickers like the tone setting. */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'focus-ring flex h-9 w-full appearance-none items-center rounded-btn border border-graphite bg-transparent px-3 pr-8 font-sans text-sm font-normal text-paper transition-quick hover:border-text-3-dark focus-visible:border-lime disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-ink-2 [&>option]:text-paper',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-text-3-dark" />
    </div>
  ),
);
Select.displayName = 'Select';

export { Select };
