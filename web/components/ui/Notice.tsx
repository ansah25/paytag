import type { HTMLAttributes } from 'react';
import { cx } from '@/lib/cx';

const TONES = {
  warn: 'bg-warn-bg text-warn',
  danger: 'bg-danger-bg text-danger',
  ok: 'bg-ok-bg text-ok',
} as const;

const SIZES = {
  md: 'px-4 py-3.5 text-sm',
  sm: 'px-3.5 py-3 text-[13px]',
} as const;

/** Tinted inline message block (wrong network, self-pay, send errors). */
export function Notice({
  tone = 'warn',
  size = 'md',
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof TONES; size?: keyof typeof SIZES }) {
  return (
    <div
      className={cx('rounded-inset-sm font-semibold leading-[1.5]', TONES[tone], SIZES[size], className)}
      {...rest}
    />
  );
}
