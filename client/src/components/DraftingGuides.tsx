import { cn } from '@/lib/utils';

interface DraftingGuidesProps {
  className?: string;
}

export function DraftingGuides({ className }: DraftingGuidesProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-0 hidden lg:block',
        className,
      )}
      aria-hidden="true"
    >
      {Array.from({ length: 11 }).map((_, i) => (
        <div
          key={i}
          className="guide-line"
          style={{ left: `${((i + 1) / 12) * 100}%` }}
        />
      ))}
    </div>
  );
}
