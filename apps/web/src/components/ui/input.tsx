import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-slate-100 placeholder:text-slate-500 shadow-inner shadow-black/10 outline-none transition focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20',
        className,
      )}
      {...props}
    />
  );
}
