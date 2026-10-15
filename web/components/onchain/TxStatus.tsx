'use client';

import { Notice } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';
import { cx } from '@/lib/cx';
import { txUrl } from '@/lib/onchain/records';
import type { TxState } from '@/lib/onchain/txMachine';

const STEPS = [
  { status: 'simulating', label: 'Checking' },
  { status: 'signing', label: 'Confirm in wallet' },
  { status: 'pending', label: 'Waiting for block' },
  { status: 'confirmed', label: 'Updating' },
  { status: 'indexed', label: 'Done' },
] as const;

const ORDER = STEPS.map((s) => s.status) as string[];

/**
 * One line per write: the five lifecycle steps with the current one spinning, a Basescan link
 * once there's a hash, and the decoded reason on failure. Renders nothing when idle.
 */
export function TxStatus({ state, className }: { state: TxState; className?: string }) {
  if (state.status === 'idle') return null;

  if (state.status === 'failed') {
    if (state.error.kind === 'rejected') {
      return <p className={cx('text-sm font-semibold text-ink2', className)}>{state.error.message}</p>;
    }
    return (
      <Notice tone="danger" size="sm" className={className} role="alert">
        {state.error.message}
        {state.hash && (
          <>
            {' '}
            <a className="underline" href={txUrl(state.hash)} target="_blank" rel="noreferrer">
              View transaction
            </a>
          </>
        )}
      </Notice>
    );
  }

  if (state.status === 'indexed' && !state.caughtUp) {
    return (
      <p className={cx('text-[13px] font-semibold text-ok', className)} aria-live="polite">
        ✓ Confirmed on-chain. The display may take a moment to catch up.{' '}
        <a className="text-ink2 underline hover:text-ink" href={txUrl(state.hash)} target="_blank" rel="noreferrer">
          Basescan ↗
        </a>
      </p>
    );
  }

  const current = ORDER.indexOf(state.status);
  const hash = 'hash' in state ? state.hash : undefined;
  return (
    <div className={cx('flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]', className)} aria-live="polite">
      {STEPS.map((step, i) => {
        const done = i < current || state.status === 'indexed';
        const active = i === current && state.status !== 'indexed';
        return (
          <span
            key={step.status}
            className={cx(
              'inline-flex items-center gap-1.5 font-semibold',
              done ? 'text-ok' : active ? 'text-ink' : 'text-ink3',
            )}
          >
            {active ? <Spinner size={12} /> : <span aria-hidden>{done ? '✓' : '○'}</span>}
            {step.label}
          </span>
        );
      })}
      {hash && (
        <a className="font-semibold text-ink2 underline hover:text-ink" href={txUrl(hash)} target="_blank" rel="noreferrer">
          Basescan ↗
        </a>
      )}
    </div>
  );
}
