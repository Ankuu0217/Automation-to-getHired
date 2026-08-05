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
          'flex h-9 w-full appearance-none items-center rounded-[8px] border border-pure/[0.06] bg-void px-3 pr-8 font-sans text-sm font-normal text-cloud shadow-none transition-quick focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pure/40 focus-visible:ring-offset-1 focus-visible:ring-offset-obsidian disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-fog" />
    </div>
  ),
);
Select.displayName = 'Select';

export { Select };
