'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, AvailabilityResponse } from '@/lib/api';

type Status = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'reserved';

const REASON_TO_STATUS: Record<NonNullable<AvailabilityResponse['reason']>, Status> = {
  TAKEN: 'taken',
  INVALID_FORMAT: 'invalid',
  RESERVED: 'reserved',
};

const messageFor = (status: Status): string => {
  switch (status) {
    case 'available':
      return "It’s yours.";
    case 'taken':
      return 'Already taken.';
    case 'invalid':
      return '3–20 letters, numbers, or underscores. Lowercase only.';
    case 'reserved':
      return 'That name is reserved.';
    case 'checking':
      return 'Checking…';
    default:
      return ' ';
  }
};

export function UsernameClaimInput() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      setStatus('idle');
      setSuggestions([]);
      return;
    }

    setStatus('checking');
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await api.available(trimmed, controller.signal);
        if (controller.signal.aborted) return;
        if (res.available) {
          setStatus('available');
          setSuggestions([]);
        } else {
          setStatus(res.reason ? REASON_TO_STATUS[res.reason] : 'taken');
          setSuggestions(res.suggestions);
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setStatus('idle');
      }
    }, 280);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [value]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (status !== 'available') return;
    router.push(`/claim/${value.trim().toLowerCase()}`);
  };

  const isError = status === 'taken' || status === 'invalid' || status === 'reserved';

  return (
    <div>
      <form onSubmit={onSubmit}>
        <div
          className={`flex items-center gap-3 bg-white border-2 rounded-2xl pl-5 pr-2 py-2 transition-all ${
            status === 'available'
              ? 'border-success shadow-[0_0_0_4px_rgba(19,188,140,0.12)]'
              : isError
                ? 'border-danger shadow-[0_0_0_4px_rgba(229,66,77,0.1)]'
                : 'border-hairline focus-within:border-primary focus-within:shadow-[0_0_0_4px_rgba(84,105,212,0.15)]'
          }`}
        >
          <span
            className="font-display font-bold text-3xl md:text-4xl select-none"
            style={{
              backgroundImage:
                'linear-gradient(135deg, #5469D4 0%, #7E5CFF 50%, #FF5A6E 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            @
          </span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value.toLowerCase())}
            placeholder="yourname"
            maxLength={20}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 bg-transparent border-0 outline-none font-display font-semibold text-2xl md:text-3xl text-ink placeholder:text-ink-4/60 min-w-0"
          />
          <button
            type="submit"
            disabled={status !== 'available'}
            className="btn-primary shrink-0"
          >
            <span className="hidden sm:inline">Claim</span>
            <span className="sm:hidden">→</span>
            <span aria-hidden className="hidden sm:inline">→</span>
          </button>
        </div>
        <div className="flex items-center justify-between mt-3 px-1 min-h-[20px]">
          <div
            className={`text-sm font-medium ${
              status === 'available'
                ? 'text-success'
                : isError
                  ? 'text-danger'
                  : 'text-ink-3'
            }`}
          >
            {status === 'idle' ? (
              <span className="text-ink-4">3–20 letters, numbers, or underscores.</span>
            ) : (
              messageFor(status)
            )}
          </div>
          {status === 'available' && (
            <div className="text-[11px] text-success font-bold uppercase tracking-eyebrow numeric">
              Available
            </div>
          )}
        </div>
      </form>

      {suggestions.length > 0 && (
        <div className="mt-5">
          <div className="eyebrow-muted mb-2.5">Try one of these</div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setValue(s)}
                className="font-mono text-[13px] text-ink-2 bg-white border border-hairline hover:border-primary hover:text-primary rounded-full px-3 py-1.5 transition-colors numeric"
              >
                @{s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
