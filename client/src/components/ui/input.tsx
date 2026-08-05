import * as React from 'react';

import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'focus-ring flex h-9 w-full rounded-btn border border-graphite bg-transparent px-3 py-1 font-sans text-sm font-normal text-paper transition-quick placeholder:text-text-3-dark hover:border-text-3-dark focus-visible:border-lime aria-[invalid=true]:border-warn disabled:cursor-not-allowed disabled:opacity-50',
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
