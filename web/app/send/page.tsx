'use client';

// Temporary: PayPanel wired in for step 4. The page itself is rewritten in step 7.

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, ResolveResponse } from '@/lib/api';
import { Avatar } from '@/components/Avatar';
import { ChainGlyph } from '@/components/ChainGlyph';
import { PayPanel } from '@/components/PayPanel';
import { PaytagChain } from '@/lib/chains';

type Status = 'idle' | 'looking' | 'found' | 'missing';
const CHAIN_ORDER: PaytagChain[] = ['ethereum', 'solana', 'bitcoin'];

const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export default function SendPage() {
  const [recipient, setRecipient] = useState('');
  const [resolution, setResolution] = useState<ResolveResponse | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    const trimmed = recipient.trim().toLowerCase().replace(/^@/, '');
    setErrorMsg(null);

    if (!trimmed) {
      setStatus('idle');
      setResolution(null);
      return;
    }

    setStatus('looking');
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const data = await api.resolve(trimmed, controller.signal);
        if (controller.signal.aborted) return;
        setResolution(data);
        setStatus('found');
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setResolution(null);
        setStatus('missing');
        if (err instanceof ApiError && err.code !== 'USER_NOT_FOUND') {
          setErrorMsg(err.message);
        }
      }
    }, 280);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [recipient]);

  const availableChains = useMemo<PaytagChain[]>(() => {
    if (!resolution) return [];
    return CHAIN_ORDER.filter((c) => Boolean(resolution.addresses[c]));
  }, [resolution]);

  const evmAddress = resolution?.addresses.ethereum;
  const trimmed = recipient.trim().replace(/^@/, '').toLowerCase();

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="relative max-w-[1240px] mx-auto px-6 md:px-10 pt-14 pb-10">
          <div className="max-w-2xl">
            <div className="mb-3">Send</div>
            <h1 className="font-display font-bold text-4xl md:text-6xl text-ink leading-[0.98]">
              Send to a name.
            </h1>
            <p className="mt-4 text-ink2 text-lg max-w-md">
              Type any @paytag and we&apos;ll resolve it. Pick the network, hit send.
            </p>
          </div>
        </div>
      </section>

      <div className="max-w-2xl mx-auto px-6 md:px-10 py-12 md:py-16 space-y-8">
        <section>
          <div className="mb-3">To</div>
          <div className="flex items-center gap-3 border-2 border-line pl-5 pr-3 py-2.5">
            <span className="font-display font-bold text-3xl md:text-4xl select-none text-accent">@</span>
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.toLowerCase().replace(/^@/, ''))}
              placeholder="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              className="flex-1 bg-transparent border-0 outline-none text-2xl md:text-3xl font-display font-semibold text-ink min-w-0"
            />
          </div>

          <div className="min-h-[20px] mt-3 px-1 text-sm">
            {status === 'idle' && (
              <span className="text-ink3">Try @derrick, @alice_99, anyone with a paytag.</span>
            )}
            {status === 'looking' && <span className="text-ink2">Looking up @{trimmed}…</span>}
            {status === 'missing' && (
              <span className="text-danger">
                {errorMsg ?? `@${trimmed} doesn’t exist.`}{' '}
                <Link href={`/claim/${trimmed}`} className="underline underline-offset-4 hover:no-underline">
                  Claim it →
                </Link>
              </span>
            )}
          </div>
        </section>

        {status === 'found' && resolution && (
          <section>
            <div className="flex items-center gap-4 border border-line p-5">
              <Avatar username={resolution.username} size={56} />
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-xl md:text-2xl text-ink">
                  @{resolution.username}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-ink2 numeric">
                  {evmAddress && <span className="font-mono">{shortAddr(evmAddress)}</span>}
                  <span>·</span>
                  <span>
                    {availableChains.length} active network{availableChains.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {CHAIN_ORDER.map((c) => (
                  <span key={c} className={resolution.addresses[c] ? '' : 'opacity-25'} title={c}>
                    <ChainGlyph chain={c} size={22} />
                  </span>
                ))}
              </div>
            </div>
          </section>
        )}

        {status === 'found' && resolution && (
          <PayPanel
            username={resolution.username}
            chains={availableChains}
            addresses={resolution.addresses}
          />
        )}
      </div>
    </>
  );
}
