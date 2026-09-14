'use client';

import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from '@/lib/cx';

export interface RailItem<T extends string> {
  id: T;
  label: ReactNode;
}

interface Props<T extends string> {
  items: RailItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Accessible name for the tablist. */
  label: string;
  /** 40px (dashboard tabs) or 44px (pay panel chain tabs). */
  size?: 40 | 44;
  /** Stretch across the container with equal-width tabs. */
  fill?: boolean;
  /** When set, tabs get `${idPrefix}-tab-${id}` ids and control `${idPrefix}-panel-${id}`. */
  idPrefix?: string;
  /** Lock the selection (e.g. while a transaction is in flight). */
  disabled?: boolean;
  className?: string;
}

export function SegmentedRail<T extends string>({
  items,
  value,
  onChange,
  label,
  size = 40,
  fill = false,
  idPrefix,
  disabled = false,
  className,
}: Props<T>) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  // Roving focus: arrows move between tabs and select, per the WAI-ARIA tabs pattern.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = items.length - 1;
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
        next = index === last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
        next = index === 0 ? last : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    e.preventDefault();
    tabs.current[next]?.focus();
    onChange(items[next].id);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx(
        'flex max-w-full overflow-x-auto rounded-pill border border-line bg-surface2 p-[5px]',
        fill ? 'w-full gap-1.5' : 'w-max gap-1',
        className,
      )}
    >
      {items.map((item, index) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              tabs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-tab-${item.id}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${item.id}` : undefined}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={disabled && !active}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cx(
              'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill text-sm font-bold transition-colors disabled:opacity-50',
              size === 44 ? 'min-h-11 px-3.5' : 'min-h-10 px-[18px]',
              fill && 'flex-1',
              active ? 'bg-surface text-ink shadow-tab' : 'text-ink2 enabled:hover:text-ink',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
