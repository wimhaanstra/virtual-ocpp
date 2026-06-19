import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'outline';

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-white/10 text-slate-100',
  success: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30',
  warning: 'bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30',
  danger: 'bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/30',
  outline: 'border border-white/10 text-slate-300',
};

export function Badge({
  className,
  variant = 'default',
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium uppercase tracking-[0.18em]',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
