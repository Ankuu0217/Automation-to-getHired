import { cn } from '@/lib/utils';

type MonoColor = 'ash' | 'fog' | 'pure' | 'cyan' | 'warn' | 'danger' | 'ok' | 'orchid';

interface MonoProps {
  children: React.ReactNode;
  color?: MonoColor;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  as?: keyof JSX.IntrinsicElements;
}

const COLOR_CLASS: Record<MonoColor, string> = {
  ash: 'text-text-2',
  fog: 'text-text-3',
  pure: 'text-pure',
  cyan: 'text-cyan',
  warn: 'text-warn',
  danger: 'text-danger',
  ok: 'text-ok',
  orchid: 'text-orchid',
};

const SIZE_CLASS: Record<MonoProps['size'] & string, string> = {
  xs: 'text-[10px] leading-[2] tracking-[0.16px]',
  sm: 'text-[11px] leading-[2] tracking-[0.16px]',
  md: 'text-xs leading-[1.35] tracking-[0.016em]',
};

export function Mono({
  children,
  color = 'ash',
  size = 'sm',
  className,
  as: Component = 'span',
}: MonoProps) {
  return (
    <Component
      className={cn(
        'font-mono uppercase',
        COLOR_CLASS[color],
        SIZE_CLASS[size],
        className,
      )}
    >
      {children}
    </Component>
  );
}
