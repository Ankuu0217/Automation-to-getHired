import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <span
      className={cn(
        'font-display text-[22px] font-normal leading-none text-pure',
        className,
      )}
    >
      GetHired
    </span>
  );
}
