import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export type TileColor = 'iris' | 'pale' | 'deep' | 'orchid' | 'peri' | 'cyan';

interface CategoryTileProps {
  color: TileColor;
  title: string;
  description: string;
  icon: LucideIcon;
  compact?: boolean;
  className?: string;
}

const COLOR_MAP: Record<TileColor, string> = {
  iris: 'bg-lime text-paper',
  pale: 'bg-pale text-ink',
  deep: 'bg-deep text-paper',
  orchid: 'bg-warn text-paper',
  peri: 'bg-peri text-paper',
  cyan: 'bg-lime text-ink',
};

export function CategoryTile({
  color,
  title,
  description,
  icon: Icon,
  compact = false,
  className,
}: CategoryTileProps) {
  return (
    <div
      className={cn(
        'flex flex-col justify-between rounded-card',
        COLOR_MAP[color],
        compact ? 'p-6' : 'p-8',
        className,
      )}
    >
      <Icon className={cn('shrink-0', compact ? 'size-5' : 'size-6')} strokeWidth={1.5} />
      <div className={cn(compact ? 'mt-6' : 'mt-10')}>
        <h3
          className={cn(
            'font-sans font-normal leading-[0.95]',
            compact ? 'text-2xl' : 'text-[38px]',
          )}
        >
          {title}
        </h3>
        <p
          className={cn(
            'font-sans font-normal leading-[1.5] opacity-90',
            compact ? 'mt-2 text-sm' : 'mt-3 text-base',
          )}
        >
          {description}
        </p>
      </div>
    </div>
  );
}
