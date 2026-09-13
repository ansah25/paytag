import type { HTMLAttributes } from 'react';
import { cx } from '@/lib/cx';

const PADDING = {
  default: 'p-[clamp(22px,3vw,32px)]',
  /** Aside/side cards. */
  compact: 'p-[22px]',
  none: '',
} as const;

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'aside';
  padding?: keyof typeof PADDING;
  /** Floating card: emphasized border + shadow. */
  elevated?: boolean;
}

export function Card({
  as: Tag = 'div',
  padding = 'default',
  elevated = false,
  className,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cx(
        'min-w-0 rounded-card border bg-surface',
        elevated ? 'border-line2 shadow-float' : 'border-line',
        PADDING[padding],
        className,
      )}
      {...rest}
    />
  );
}
