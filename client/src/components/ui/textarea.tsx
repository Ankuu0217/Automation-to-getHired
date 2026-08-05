import * as React from 'react';

import { cn } from '@/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'focus-ring flex min-h-[80px] w-full rounded-btn border border-graphite bg-ink px-3 py-2 font-sans text-sm font-normal text-paper transition-quick placeholder:text-text-3-dark hover:border-text-3-dark-dark aria-[invalid=true]:border-warn disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
