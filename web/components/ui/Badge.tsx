import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';

const TONES = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  // ink2 rather than ink3: ink3 on surface2 is below 4.5:1.
  muted: 'bg-surface2 text-ink2',
} as const;

const SIZES = {
  /** Inline with row labels (addresses list). */
  sm: 'px-[7px] py-[3px] text-[10px]',
  md: 'px-[9px] py-[5px] text-[11px]',
} as const;

export function Badge({
  tone = 'ok',
  size = 'md',
  className,
  children,
}: {
  tone?: keyof typeof TONES;
  size?: keyof typeof SIZES;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-pill font-bold uppercase tracking-label',
        TONES[tone],
        SIZES[size],
        className,
      )}
    >
      {children}
    </span>
  );
}
