import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Styled native range input. Thumb/track styling lives in index.css under
 * the `.slider` component class (webkit + moz pseudo-elements can't be
 * expressed as Tailwind utilities).
 */
export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, min, max, ...props }, ref) => (
    <input
      type="range"
      ref={ref}
      min={min ?? 0}
      max={max ?? 100}
      className={cn('slider w-full', className)}
      {...props}
    />
  ),
);
Slider.displayName = 'Slider';

export { Slider };
