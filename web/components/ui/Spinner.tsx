import { cx } from '@/lib/cx';

export function Spinner({ size = 14, className }: { size?: 12 | 14; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent',
        size === 12 ? 'h-3 w-3' : 'h-3.5 w-3.5',
        className,
      )}
    />
  );
}
