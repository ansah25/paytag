'use client';

import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from '@/lib/cx';

export type FieldStatus = 'idle' | 'checking' | 'valid' | 'error';
export type FieldSize = 'md' | 'lg' | 'xl';

// Valid/error borders don't change on focus, so keyboard focus gets the global
// accent ring on the wrapper instead (the input's own outline is suppressed).
const FOCUS_RING =
  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent';

const BORDER: Record<FieldStatus, string> = {
  idle: 'border-line2 focus-within:border-accent',
  checking: 'border-accent',
  valid: `border-ok ${FOCUS_RING}`,
  error: `border-danger ${FOCUS_RING}`,
};

const PILL_PADDING: Record<FieldSize, string> = {
  md: 'py-1 pl-4 pr-1',
  lg: 'py-1.5 pl-5 pr-1.5',
  xl: 'py-1.5 pl-[22px] pr-1.5',
};

const PILL_INPUT: Record<FieldSize, string> = {
  md: 'h-11 px-2 text-[15px]',
  lg: 'h-12 px-2 font-display text-[22px] font-semibold tracking-display',
  xl: 'h-[52px] px-2 font-display text-[26px] font-semibold tracking-display',
};

const AT_GLYPH: Record<FieldSize, string> = {
  md: 'text-[15px]',
  lg: 'font-display text-[22px]',
  xl: 'font-display text-[26px]',
};

const MESSAGE_TONE = {
  muted: 'text-ink2',
  ok: 'text-ok',
  danger: 'text-danger',
} as const;

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  status?: FieldStatus;
  /** `pill` for claim/recipient inputs; `inset` (14px radius, 48px) for form fields. */
  shape?: 'pill' | 'inset';
  /** Pill only: md = body text, lg = 22px display, xl = 26px display. */
  size?: FieldSize;
  /** Leading accent "@" glyph. */
  at?: boolean;
  mono?: boolean;
  /** Background; pills default to `surface`, inset fields to `surface2`. */
  surface?: 'surface' | 'surface2';
  /** Rendered inside the border after the input — e.g. a "Claim" button. */
  trailing?: ReactNode;
  label?: ReactNode;
  /** Status line under the field (left). */
  message?: ReactNode;
  messageTone?: keyof typeof MESSAGE_TONE;
  /** Static helper under the field (right), e.g. "3–20 letters, numbers, _". */
  hint?: ReactNode;
  wrapperClassName?: string;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  {
    status = 'idle',
    shape = 'pill',
    size = 'md',
    at = false,
    mono = false,
    surface,
    trailing,
    label,
    message,
    messageTone = 'muted',
    hint,
    wrapperClassName,
    className,
    id,
    ...inputProps
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-message`;
  const hasFooter = message !== undefined || hint !== undefined;
  const background = surface ?? (shape === 'pill' ? 'surface' : 'surface2');

  return (
    <div className={cx('grid gap-2', wrapperClassName)}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-xs font-bold uppercase tracking-label text-ink3"
        >
          {label}
        </label>
      )}
      <div
        className={cx(
          'flex items-center gap-1.5 border-[1.5px] transition-colors',
          background === 'surface' ? 'bg-surface' : 'bg-surface2',
          shape === 'pill' ? cx('rounded-pill', PILL_PADDING[size]) : 'rounded-inset-sm px-4',
          BORDER[status],
        )}
      >
        {at && (
          <span aria-hidden className={cx('select-none font-semibold text-accent', AT_GLYPH[size])}>
            @
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={status === 'error' || undefined}
          aria-describedby={hasFooter ? messageId : undefined}
          className={cx(
            'min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink3 focus-visible:outline-none',
            shape === 'pill' ? PILL_INPUT[size] : 'h-[45px] text-[15px]',
            mono && 'font-mono text-sm tracking-normal',
            className,
          )}
          {...inputProps}
        />
        {trailing}
      </div>
      {hasFooter && (
        <div id={messageId} className="flex justify-between gap-3 px-1 text-[13px] font-medium">
          <span aria-live="polite" className={MESSAGE_TONE[messageTone]}>
            {message}
          </span>
          {hint && <span className="shrink-0 text-ink3">{hint}</span>}
        </div>
      )}
    </div>
  );
});
