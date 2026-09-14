'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api, type AvailabilityResponse } from '@/lib/api';
import { cx } from '@/lib/cx';
import { Button } from './ui/Button';
import { Field, type FieldStatus } from './ui/Field';

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export const normalizeUsername = (value: string) => value.trim().toLowerCase().replace(/^@/, '');

export type ClaimStatus = 'idle' | 'checking' | 'available' | 'taken' | 'reserved' | 'invalid' | 'offline';

const REASON_STATUS: Record<NonNullable<AvailabilityResponse['reason']>, ClaimStatus> = {
  TAKEN: 'taken',
  RESERVED: 'reserved',
  INVALID_FORMAT: 'invalid',
};

const MESSAGE: Record<ClaimStatus, string> = {
  idle: '',
  checking: 'Checking…',
  available: 'Available — it’s yours.',
  taken: 'Already taken.',
  reserved: 'That name is reserved.',
  invalid: '3–20 lowercase letters, numbers or underscores.',
  offline: 'Couldn’t check right now — try again in a moment.',
};

const FIELD_STATUS: Record<ClaimStatus, FieldStatus> = {
  idle: 'idle',
  checking: 'checking',
  available: 'valid',
  taken: 'error',
  reserved: 'error',
  invalid: 'error',
  offline: 'idle',
};

const DEBOUNCE_MS = 280;

interface Props {
  /** xl = 26px (landing hero), lg = 22px (final CTA, wizard pick step). */
  size?: 'lg' | 'xl';
  surface?: 'surface' | 'surface2';
  submitLabel?: string;
  /** Defaults to navigating to /claim/[name]. */
  onSubmitName?: (name: string) => void;
  /** Normalized value on every change (e.g. to preview the name elsewhere). */
  onValueChange?: (name: string) => void;
  /** Availability result for the current value. */
  onStatusChange?: (status: ClaimStatus, name: string) => void;
  suggestionsAlign?: 'start' | 'center';
  autoFocus?: boolean;
  id?: string;
  className?: string;
}

/** Pill username input with debounced availability check and suggestions. */
export function ClaimInput({
  size = 'xl',
  surface = 'surface',
  submitLabel = 'Claim',
  onSubmitName,
  onValueChange,
  onStatusChange,
  suggestionsAlign = 'start',
  autoFocus,
  id,
  className,
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<ClaimStatus>('idle');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);
  const onValueChangeRef = useRef(onValueChange);
  onValueChangeRef.current = onValueChange;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  useEffect(() => {
    clearTimeout(timer.current);
    abort.current?.abort();
    const name = normalizeUsername(value);
    onValueChangeRef.current?.(name);
    setSuggestions([]);

    if (!name) {
      setStatus('idle');
      return;
    }
    if (!USERNAME_PATTERN.test(name)) {
      // Don't flag a valid-so-far name that's just too short yet.
      setStatus(/^[a-z0-9_]{1,2}$/.test(name) ? 'idle' : 'invalid');
      return;
    }

    setStatus('checking');
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      abort.current = controller;
      try {
        const res = await api.available(name, controller.signal);
        if (controller.signal.aborted) return;
        if (res.available) {
          setStatus('available');
        } else {
          setStatus(res.reason ? REASON_STATUS[res.reason] : 'taken');
          setSuggestions(res.suggestions);
        }
      } catch {
        if (!controller.signal.aborted) setStatus('offline');
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer.current);
      abort.current?.abort();
    };
  }, [value]);

  useEffect(() => {
    onStatusChangeRef.current?.(status, normalizeUsername(value));
    // `value` changes are reported once their status settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (status !== 'available') return;
    const name = normalizeUsername(value);
    if (onSubmitName) onSubmitName(name);
    else router.push(`/claim/${name}`);
  };

  const isError = FIELD_STATUS[status] === 'error';

  return (
    <form onSubmit={onSubmit} className={cx('grid gap-3', className)}>
      <Field
        id={id}
        size={size}
        surface={surface}
        at
        status={FIELD_STATUS[status]}
        value={value}
        onChange={(e) => setValue(e.target.value.toLowerCase().replace(/^@/, '').replace(/\s/g, ''))}
        placeholder="yourname"
        maxLength={20}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-label="Username to claim"
        message={MESSAGE[status]}
        messageTone={status === 'available' ? 'ok' : isError ? 'danger' : 'muted'}
        hint="3–20 letters, numbers, _"
        trailing={
          <Button type="submit" size={48} disabled={status !== 'available'} className="self-stretch">
            {submitLabel}
          </Button>
        }
      />
      {suggestions.length > 0 && (
        <div
          aria-label="Available alternatives"
          className={cx('flex flex-wrap gap-2 px-1', suggestionsAlign === 'center' && 'justify-center')}
        >
          {suggestions.map((s) => (
            <SuggestionChip key={s} onClick={() => setValue(s)}>
              @{s}
            </SuggestionChip>
          ))}
        </div>
      )}
    </form>
  );
}

const CHIP =
  'inline-flex min-h-10 items-center whitespace-nowrap rounded-pill border border-line bg-surface2 px-3.5 text-[13px] font-semibold text-ink transition-colors hover:border-accent hover:text-accent';

/** Username suggestion pill — a link to /claim/[name] or a button. */
export function SuggestionChip({
  href,
  onClick,
  children,
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  if (href) {
    return (
      <Link href={href} className={CHIP}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={CHIP}>
      {children}
    </button>
  );
}
