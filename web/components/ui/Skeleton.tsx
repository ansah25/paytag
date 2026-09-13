import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';

const SHAPES = {
  bar: 'rounded-pill bg-surface2',
  circle: 'rounded-full bg-surface2',
  /** Inset placeholder, e.g. the pay panel body. */
  block: 'rounded-inset-xl bg-surface2',
  card: 'rounded-card border border-line bg-surface',
} as const;

/** Placeholder block. Size it with className (`h-10 w-[200px]`). */
export function Skeleton({
  shape = 'bar',
  delay = 0,
  className,
}: {
  shape?: keyof typeof SHAPES;
  /** Stagger in ms so neighbouring blocks don't pulse in lockstep. */
  delay?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx('block animate-shimmer', SHAPES[shape], className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    />
  );
}

/** Small accent dot. `shimmer` for loading rows, `pulse` for in-progress steps. */
export function PulseDot({
  kind = 'pulse',
  className,
}: {
  kind?: 'pulse' | 'shimmer';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block h-2 w-2 shrink-0 rounded-full bg-accent',
        kind === 'pulse' ? 'animate-pulse' : 'animate-[shimmer_1.2s_ease-in-out_infinite]',
        className,
      )}
    />
  );
}

/** "Loading…" / "Restoring your session…" / "Resolving @name…" row. */
export function SkeletonStatus({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="status" className={cx('flex items-center gap-2.5 text-sm font-semibold text-ink2', className)}>
      <PulseDot kind="shimmer" />
      {children}
    </div>
  );
}
