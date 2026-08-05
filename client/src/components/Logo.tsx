import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <span
      className={cn(
        'font-sans text-subheading font-normal leading-none text-paper',
        className,
      )}
    >
      GetHired
    </span>
  );
}
