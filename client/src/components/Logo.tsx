import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <span
      className={cn(
        'font-sans text-[22px] font-normal leading-none text-paper',
        className,
      )}
    >
      GetHired
    </span>
  );
}
