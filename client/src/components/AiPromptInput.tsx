import { ArrowRight } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

interface AiPromptInputProps {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  className?: string;
}

export function AiPromptInput({
  placeholder = 'Ask anything…',
  value,
  onChange,
  onSubmit,
  className,
}: AiPromptInputProps) {
  const [internalValue, setInternalValue] = React.useState(value ?? '');
  const controlled = value !== undefined;
  const currentValue = controlled ? value : internalValue;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit?.(currentValue);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'flex items-center gap-3 rounded-func border border-border bg-background py-2 pl-[22px] pr-2 transition-quick focus-within:border-border-strong',
        className,
      )}
    >
      <input
        type="text"
        value={currentValue}
        onChange={(e) => {
          if (!controlled) setInternalValue(e.target.value);
          onChange?.(e.target.value);
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent py-[6px] font-sans text-base font-normal text-text-1 placeholder:text-text-3 outline-none"
      />
      <button
        type="submit"
        aria-label="Submit"
        className="focus-ring flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-quick hover:opacity-[0.92] active:opacity-[0.85]"
      >
        <ArrowRight className="size-4" />
      </button>
    </form>
  );
}
