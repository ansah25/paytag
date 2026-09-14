import { useId } from 'react';
import { cx } from '@/lib/cx';

/**
 * Diagonal-striped empty-state block. Drawn with an SVG pattern rather than a
 * repeating-linear-gradient so the no-gradients rule holds. Size via className.
 */
export function StripedPlaceholder({ className }: { className?: string }) {
  const patternId = `stripes-${useId().replace(/:/g, '')}`;
  return (
    <div
      aria-hidden
      className={cx('overflow-hidden rounded-inset border border-dashed border-line2 text-surface2', className)}
    >
      <svg width="100%" height="100%">
        <defs>
          <pattern
            id={patternId}
            width="16"
            height="16"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="8" height="16" fill="currentColor" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}
