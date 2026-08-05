import * as React from 'react';

import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-[8px] border border-pure/[0.06] bg-void px-3 py-1 font-sans text-sm font-normal text-cloud shadow-none transition-quick placeholder:text-fog focus-visible:border-pure focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pure/30 focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
