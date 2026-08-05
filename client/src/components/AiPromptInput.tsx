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
        'flex items-center gap-3 rounded-[8px] border border-pure/10 bg-void py-2 pl-[22px] pr-2 transition-quick focus-within:border-pure/25',
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
        className="min-w-0 flex-1 bg-transparent py-[6px] font-sans text-base font-normal text-pure placeholder:text-fog outline-none"
      />
      <button
        type="submit"
        aria-label="Submit"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-pure/20 text-pure transition-quick hover:bg-pure/30"
      >
        <ArrowRight className="size-4" />
      </button>
    </form>
  );
}
