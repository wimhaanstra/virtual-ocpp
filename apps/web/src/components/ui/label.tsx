import type { LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('text-xs font-medium uppercase tracking-[0.2em] text-slate-400', className)}
      {...props}
    />
  );
}
