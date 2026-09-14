'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { normalizeUsername, USERNAME_PATTERN } from '@/components/ClaimInput';
import { PayPanel } from '@/components/PayPanel';
import { ChainDot } from '@/components/ui/ChainDot';
import { Field, type FieldStatus } from '@/components/ui/Field';
import { PulseDot, Skeleton } from '@/components/ui/Skeleton';
import { api, ApiError, type ResolveResponse } from '@/lib/api';
import { CHAIN_META, CHAIN_ORDER } from '@/lib/pay/meta';
import { clearRecent, readRecent, rememberRecent, timeAgo, type RecentRecipient } from '@/lib/recent';

type Status = 'idle' | 'looking' | 'found' | 'missing' | 'invalid' | 'error';

const LOOKUP_DEBOUNCE_MS = 280;
const SUGGESTED = ['derrick', 'alice', 'sam'];
const INPUT_ID = 'send-recipient';

const FIELD_STATUS: Record<Status, FieldStatus> = {
  idle: 'idle',
  looking: 'checking',
  found: 'valid',
  missing: 'error',
  invalid: 'error',
  error: 'error',
};

export default function SendPage() {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [resolution, setResolution] = useState<ResolveResponse | null>(null);
  const [recent, setRecent] = useState<RecentRecipient[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setRecent(readRecent());
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    abort.current?.abort();
    setResolution(null);

    const name = normalizeUsername(value);
    if (/^[a-z0-9_]{0,2}$/.test(name)) {
      setStatus('idle');
      return;
    }
    if (!USERNAME_PATTERN.test(name)) {
      setStatus('invalid');
      return;
    }

    setStatus('looking');
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      abort.current = controller;
      try {
        const data = await api.resolve(name, controller.signal);
        if (controller.signal.aborted) return;
        setResolution(data);
        setStatus('found');
        setRecent(rememberRecent(data.username));
      } catch (err) {
        if (controller.signal.aborted) return;
        const notFound = err instanceof ApiError && (err.code === 'USER_NOT_FOUND' || err.status === 404);
        setStatus(notFound ? 'missing' : 'error');
      }
    }, LOOKUP_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer.current);
      abort.current?.abort();
    };
  }, [value]);

  const pick = (name: string) => {
    setValue(name);
    inputRef.current?.focus();
  };

  const name = normalizeUsername(value);
  const showIdleHelpers = status === 'idle' && !name;

  let statusLine: ReactNode = null;
  if (status === 'looking') statusLine = <span className="text-ink2">Looking up @{name}…</span>;
  else if (status === 'found') statusLine = <span className="text-ok">Found.</span>;
  else if (status === 'missing') {
    statusLine = (
      <span className="text-danger">
        @{name} isn’t a paytag yet.{' '}
        <Link href={`/claim/${name}`} className="font-bold text-accent">
          Claim it →
        </Link>
      </span>
    );
  } else if (status === 'invalid') {
    statusLine = <span className="text-danger">Paytags are 3–20 lowercase letters, numbers or underscores.</span>;
  } else if (status === 'error') {
    statusLine = <span className="text-danger">Couldn’t look that up. Check your connection and try again.</span>;
  }

  const activeChains = resolution ? CHAIN_ORDER.filter((c) => resolution.addresses[c]) : [];

  return (
    <section className="mx-auto grid w-full max-w-[640px] gap-5 px-6 pb-24 pt-14">
      <div className="animate-enter">
        <div className="text-[13px] font-semibold text-accent">Send</div>
        <h1 className="mt-2 font-display text-[clamp(36px,5vw,56px)] font-semibold leading-none tracking-display-lg">
          Send to a name.
        </h1>
        <p className="mt-3.5 max-w-[440px] text-base leading-[1.55] text-ink2">
          Type any @paytag. We resolve it, you pick the chain, your wallet does the rest.
        </p>
      </div>

      <div className="animate-enter [animation-delay:50ms]">
        <label
          htmlFor={INPUT_ID}
          className="mb-2 ml-[22px] block text-xs font-bold uppercase tracking-label text-ink3"
        >
          To
        </label>
        <Field
          ref={inputRef}
          id={INPUT_ID}
          size="xl"
          at
          status={FIELD_STATUS[status]}
          value={value}
          onChange={(e) => setValue(e.target.value.toLowerCase().replace(/^@/, '').replace(/\s/g, ''))}
          placeholder="username"
          maxLength={20}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          aria-describedby="send-status"
          trailing={status === 'looking' ? <PulseDot className="mr-3.5 h-2.5 w-2.5" /> : undefined}
        />
        <div
          id="send-status"
          aria-live="polite"
          className="mx-[22px] mt-2.5 min-h-[18px] text-[13px] font-medium"
        >
          {statusLine}
        </div>

        {showIdleHelpers && recent.length > 0 && (
          <div className="mt-[18px] grid gap-2">
            <div className="mx-[22px] flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-label text-ink3">Recent</span>
              <button
                type="button"
                onClick={() => {
                  clearRecent();
                  setRecent([]);
                }}
                className="-my-3 py-3 text-xs font-semibold text-ink3 transition-colors hover:text-danger"
              >
                Clear
              </button>
            </div>
            <div className="grid gap-1">
              {recent.map((r) => (
                <button
                  key={r.name}
                  type="button"
                  onClick={() => pick(r.name)}
                  className="flex min-h-[52px] items-center gap-3 rounded-inset border border-transparent px-3.5 py-2.5 text-left transition-colors hover:border-line hover:bg-surface"
                >
                  <span
                    aria-hidden
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface2 font-display text-sm font-bold text-accent"
                  >
                    {r.name.charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold">@{r.name}</span>
                    <span className="mt-px block text-xs text-ink3">{timeAgo(r.at)}</span>
                  </span>
                  <span aria-hidden className="text-[13px] text-ink2">
                    →
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {showIdleHelpers && (
          <div className="mx-[22px] mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] text-ink3">Try</span>
            {SUGGESTED.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => pick(suggestion)}
                // ::before extends the 32px chip to a 40px hit area.
                className="relative whitespace-nowrap rounded-pill border border-line px-3 py-1.5 text-[13px] font-semibold text-ink2 transition-colors before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:border-accent hover:text-accent"
              >
                @{suggestion}
              </button>
            ))}
          </div>
        )}
      </div>

      {status === 'looking' && (
        <div aria-hidden className="grid gap-3.5">
          <div className="flex items-center gap-3.5 rounded-inset-xl border border-line bg-surface px-5 py-4">
            <Skeleton shape="circle" className="h-12 w-12 shrink-0" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-[18px] w-[140px]" />
              <Skeleton className="h-3 w-[100px]" delay={200} />
            </div>
          </div>
          <Skeleton shape="card" className="h-[300px]" delay={100} />
        </div>
      )}

      {status === 'found' && resolution && (
        <div className="grid animate-enter gap-3.5">
          <div className="flex items-center gap-3.5 rounded-inset-xl border border-line bg-surface px-5 py-4">
            <span
              aria-hidden
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface2 font-display text-xl font-bold text-accent"
            >
              {resolution.username.charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-xl font-semibold tracking-display">
                @{resolution.username}
              </div>
              <div className="mt-0.5 text-[13px] text-ink2">
                {activeChains.length === 0
                  ? 'No addresses added yet'
                  : `${activeChains.length} active network${activeChains.length === 1 ? '' : 's'}`}
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5 max-[400px]:hidden">
              {CHAIN_ORDER.map((c) => (
                <ChainDot
                  key={c}
                  chain={c}
                  size={12}
                  muted={!resolution.addresses[c]}
                  title={`${CHAIN_META[c].label}${resolution.addresses[c] ? '' : ' · not set'}`}
                />
              ))}
            </div>
            <Link
              href={`/${resolution.username}`}
              className="inline-flex min-h-10 shrink-0 items-center whitespace-nowrap text-[13px] font-semibold text-ink2 transition-colors hover:text-accent"
            >
              Profile →
            </Link>
          </div>

          <PayPanel
            key={resolution.username}
            username={resolution.username}
            chains={activeChains}
            addresses={resolution.addresses}
            verified={resolution.verified}
          />
        </div>
      )}
    </section>
  );
}
