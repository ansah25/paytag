'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Address } from 'viem';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, type FieldStatus } from '@/components/ui/Field';
import { REGISTRY_ADDRESS } from '@/lib/onchain/generated/deployment';
import { normalizeName } from '@/lib/onchain/generated/names';
import { PaytagRegistryAbi } from '@/lib/onchain/generated/PaytagRegistryAbi';
import { RESERVED_NODES } from '@/lib/onchain/generated/reservedNodes';
import { indexer, type Availability } from '@/lib/onchain/indexer';
import {
  MIN_COMMITMENT_AGE,
  PENDING_COMMIT_GRACE_MS,
  clearReservation,
  commitmentFor,
  loadReservation,
  makeSecret,
  reservationPhase,
  saveReservation,
  type Reservation,
  type ReservationPhase,
} from '@/lib/onchain/registration';
import { useOnchainTx } from '@/lib/onchain/useOnchainTx';
import { TxStatus } from './TxStatus';
import { WalletBar, useConnectWallet } from './WalletBar';

type Check =
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'reserved' }
  | { kind: 'checking' }
  | { kind: 'result'; result: Availability }
  | { kind: 'unreachable' };

const DEBOUNCE_MS = 350;

/** Where the current name's two-step registration stands. */
type Step =
  | { kind: 'none' }
  | { kind: 'checking' }
  // Saved and sent, but the commit isn't visible on-chain yet (e.g. the page was refreshed mid-tx).
  | { kind: 'confirming'; reservation: Reservation }
  | { kind: 'reserved'; reservation: Reservation; phase: ReservationPhase };

/**
 * Search and register. Format and the reserved list are checked locally (same rules as the
 * contract); "taken" comes from the indexer. If the indexer is down, registering still works:
 * the pre-flight simulation reverts with NameTaken for a taken name.
 *
 * Registration is two transactions (PaytagRegistry v0.2 commit-reveal): Reserve commits to
 * (name, wallet, secret) without revealing the name; after MIN_COMMITMENT_AGE, Register reveals
 * it. The secret is kept in localStorage so a refresh during the wait doesn't lose it; whatever
 * is stored is re-checked against the chain before use, and cleared if it expired or is gone.
 */
export function RegisterPanel() {
  const tx = useOnchainTx();
  const { connect, connecting, error: connectError } = useConnectWallet();
  const [input, setInput] = useState('');
  const [check, setCheck] = useState<Check>({ kind: 'empty' });
  const [recheck, setRecheck] = useState(0);
  const [registered, setRegistered] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'none' });
  const [stepNote, setStepNote] = useState<string | null>(null);
  const [txLabel, setTxLabel] = useState<string | null>(null);
  // Chain time minus local time (seconds), so the countdown follows the chain, not the device clock.
  const [chainOffset, setChainOffset] = useState(0);
  const [, setTick] = useState(0);
  const { publicClient, address } = tx;
  // The wallet + name the panel shows right now, for async callbacks that outlive a change.
  const currentKey = useRef('');

  const parsed = useMemo(() => (input.trim() ? normalizeName(input.trim()) : null), [input]);

  useEffect(() => {
    if (!parsed) return setCheck({ kind: 'empty' });
    if (!parsed.ok) return setCheck({ kind: 'invalid', reason: parsed.reason });
    if (RESERVED_NODES.has(parsed.node)) return setCheck({ kind: 'reserved' });

    setCheck({ kind: 'checking' });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      indexer
        .available(parsed.name, controller.signal)
        .then((result) => setCheck({ kind: 'result', result }))
        .catch((err) => {
          if ((err as Error)?.name !== 'AbortError') setCheck({ kind: 'unreachable' });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [parsed, recheck]);

  const name = parsed?.ok ? parsed.name : null;
  currentKey.current = `${address?.toLowerCase() ?? ''}:${name ?? ''}`;
  const isCurrent = (r: Reservation) => currentKey.current === `${r.owner}:${r.name}`;

  const chainNow = useCallback(async () => {
    if (!publicClient) return Math.floor(Date.now() / 1000);
    const block = await publicClient.getBlock({ blockTag: 'latest' });
    const now = Number(block.timestamp);
    setChainOffset(now - Date.now() / 1000);
    return now;
  }, [publicClient]);

  /** Re-reads a reservation's commitment on-chain and decides what to show. */
  const refreshStep = useCallback(
    async (reservation: Reservation) => {
      if (!publicClient) return;
      setStep({ kind: 'checking' });
      try {
        const [committedAt, now] = await Promise.all([
          publicClient.readContract({
            address: REGISTRY_ADDRESS as Address,
            abi: PaytagRegistryAbi,
            functionName: 'commitmentTime',
            args: [reservation.owner as Address, reservation.commitment],
          }),
          chainNow(),
        ]);
        if (!isCurrent(reservation)) return; // the user moved on while this was loading
        const phase = reservationPhase(Number(committedAt), now);
        if (phase.kind === 'missing' && Date.now() - reservation.savedAt < PENDING_COMMIT_GRACE_MS) {
          setStep({ kind: 'confirming', reservation }); // its commit may still be on the way
          return;
        }
        if (phase.kind === 'missing' || phase.kind === 'expired') {
          clearReservation(reservation.owner, reservation.name);
          setStepNote(phase.kind === 'expired' ? 'Your earlier reservation expired. Reserve again to continue.' : null);
          setStep({ kind: 'none' });
          return;
        }
        setStep({ kind: 'reserved', reservation, phase });
      } catch {
        // Can't read the chain right now: keep the stored reservation and let Register try it.
        if (isCurrent(reservation)) setStep({ kind: 'reserved', reservation, phase: { kind: 'ready', expiresAt: 0 } });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isCurrent reads a ref
    [publicClient, chainNow],
  );

  // While a commit is on its way, look again every few seconds.
  const confirming = step.kind === 'confirming' ? step.reservation : null;
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => void refreshStep(confirming), 4000);
    return () => clearTimeout(timer);
  }, [confirming, refreshStep]);

  // A reservation stored for this wallet + name (e.g. before a refresh) picks up where it left off.
  useEffect(() => {
    setStepNote(null);
    if (!name || !address) return setStep({ kind: 'none' });
    const stored = loadReservation(address, name);
    if (!stored) return setStep({ kind: 'none' });
    void refreshStep(stored);
  }, [name, address, refreshStep]);

  // Countdown: tick every second while waiting, and flip to ready on chain time.
  const waitingUntil = step.kind === 'reserved' && step.phase.kind === 'waiting' ? step.phase.revealableAt : null;
  useEffect(() => {
    if (waitingUntil === null) return;
    const timer = setInterval(() => {
      setTick((n) => n + 1);
      if (Date.now() / 1000 + chainOffset >= waitingUntil) {
        setStep((st) => (st.kind === 'reserved' ? { ...st, phase: { kind: 'ready', expiresAt: waitingUntil - MIN_COMMITMENT_AGE + 86_400 } } : st));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [waitingUntil, chainOffset]);
  const secondsLeft = waitingUntil === null ? 0 : Math.max(0, Math.ceil(waitingUntil - (Date.now() / 1000 + chainOffset)));
  // Once our own registration lands, the recheck says "taken"; that's the success, not an error.
  // It may also still say "available" if the indexer lagged, so Register stays off either way.
  const justRegistered = registered !== null && registered === name && tx.state.status === 'indexed';
  const canRegister =
    !!name && !justRegistered && (check.kind === 'unreachable' || (check.kind === 'result' && check.result.available));

  const reserve = () => {
    if (!name || !address) return;
    setRegistered(null);
    setStepNote(null);
    const secret = makeSecret();
    const reservation: Reservation = {
      name,
      owner: address.toLowerCase(),
      secret,
      commitment: commitmentFor(name, address, secret),
      savedAt: Date.now(),
    };
    saveReservation(reservation);
    setTxLabel('Step 1 of 2: reserve');
    tx.run(
      { kind: 'commit', commitment: reservation.commitment },
      {
        context: { name },
        skipIndexer: true, // the indexer doesn't track commitments
        onConfirmed: (_hash, blockNumber) => {
          void (async () => {
            try {
              const block = await publicClient!.getBlock({ blockNumber });
              setChainOffset(Number(block.timestamp) - Date.now() / 1000);
              // Switched name or wallet meanwhile: the reservation stays saved for when they return.
              if (!isCurrent(reservation)) return;
              setStep({
                kind: 'reserved',
                reservation,
                phase: { kind: 'waiting', revealableAt: Number(block.timestamp) + MIN_COMMITMENT_AGE },
              });
            } catch {
              void refreshStep(reservation);
            }
          })();
        },
        // Drop the secret only when the commit certainly didn't land (rejected, or reverted).
        // After a receipt timeout it may still confirm, so keep it and keep looking.
        onFailed: (error) => {
          if (error.kind === 'rejected' || error.kind === 'revert') {
            clearReservation(reservation.owner, reservation.name);
          } else if (isCurrent(reservation)) {
            setStep({ kind: 'confirming', reservation });
          }
        },
      },
    );
  };

  const register = () => {
    if (step.kind !== 'reserved') return;
    const { reservation } = step;
    // Only ever reveal the reservation for the name and wallet on screen.
    if (!isCurrent(reservation)) return;
    const regName = reservation.name;
    setRegistered(null);
    setTxLabel('Step 2 of 2: register');
    tx.run(
      { kind: 'register', name: regName, secret: reservation.secret },
      {
        context: { name: regName },
        // Optimistic: the name reads as registered as soon as the tx is broadcast…
        onSubmitted: () => setRegistered(regName),
        // …and is rolled back with the reason if anything fails. An expired or missing
        // commitment can't be retried, so its secret is dropped and the flow starts over.
        onFailed: (error) => {
          setRegistered(null);
          setRecheck((n) => n + 1);
          if (error.errorName === 'CommitmentTooOld' || error.errorName === 'CommitmentNotFound') {
            clearReservation(reservation.owner, reservation.name);
            setStep({ kind: 'none' });
          }
        },
        onIndexed: () => {
          clearReservation(reservation.owner, reservation.name);
          setStep({ kind: 'none' });
          setRecheck((n) => n + 1);
        },
      },
    );
  };

  const reserved = step.kind === 'reserved' ? step : null;
  const ready = reserved?.phase.kind === 'ready';
  const act = () => (ready ? register() : reserve());

  const status: FieldStatus = justRegistered
    ? 'valid'
    : check.kind === 'checking'
      ? 'checking'
      : check.kind === 'invalid' || check.kind === 'reserved' || (check.kind === 'result' && !check.result.available)
        ? 'error'
        : check.kind === 'result'
          ? 'valid'
          : 'idle';

  const message = (() => {
    if (justRegistered) return undefined;
    switch (check.kind) {
      case 'invalid':
        return `Not a valid name: ${check.reason}.`;
      case 'reserved':
        return `@${name} is reserved and can’t be registered.`;
      case 'checking':
        return 'Checking…';
      case 'unreachable':
        return 'Couldn’t check availability right now. You can still try; the contract rejects taken names.';
      case 'result':
        return check.result.available
          ? `@${name} is available.`
          : check.result.reason === 'TAKEN'
            ? `@${name} is already registered.`
            : `@${name} can’t be registered.`;
      default:
        return undefined;
    }
  })();

  const suggestions = check.kind === 'result' && !justRegistered ? check.result.suggestions : [];
  const action = !tx.connected ? (
    <Button size={48} onClick={connect} loading={connecting || tx.checking}>
      Connect wallet
    </Button>
  ) : tx.wrongNetwork ? (
    <Button size={48} onClick={() => tx.switchToBase().catch(() => {})} loading={tx.switching}>
      Switch network
    </Button>
  ) : reserved && !ready ? (
    <Button size={48} disabled loading={step.kind !== 'reserved' || secondsLeft > 0} loadingLabel={`Register in ${secondsLeft}s`}>
      Register
    </Button>
  ) : (
    <Button
      size={48}
      onClick={act}
      disabled={!canRegister || tx.busy || step.kind === 'checking' || step.kind === 'confirming'}
      loading={tx.busy}
      loadingLabel={ready ? 'Registering…' : 'Reserving…'}
    >
      {ready ? 'Register' : 'Reserve'}
    </Button>
  );

  return (
    <div className="grid gap-5">
      <WalletBar wrongNetwork={tx.wrongNetwork} switchToBase={tx.switchToBase} switching={tx.switching} />
      <Card elevated className="grid gap-4">
        <div>
          <h2 className="font-display text-[22px] font-semibold">Register a name on Base</h2>
          <p className="mt-1 text-sm text-ink2">
            Free and permanent. You own it with your wallet, and you can point it at Ethereum, Base, Solana and Bitcoin
            addresses. It takes two quick transactions: reserve, then register {MIN_COMMITMENT_AGE} seconds later. Reserving
            hides which name you’re claiming, so nobody can see it and claim it first.
          </p>
        </div>
        <Field
          shape="pill"
          size="lg"
          at
          autoComplete="off"
          spellCheck={false}
          aria-label="Name to register"
          placeholder="yourname"
          value={input}
          maxLength={21}
          onChange={(e) => {
            setInput(e.target.value);
            if (!tx.busy) tx.reset();
          }}
          onKeyDown={(e) =>
            e.key === 'Enter' &&
            canRegister &&
            tx.connected &&
            !tx.wrongNetwork &&
            !tx.busy &&
            step.kind !== 'checking' &&
            step.kind !== 'confirming' &&
            (!reserved || ready) &&
            act()
          }
          disabled={tx.busy}
          status={status}
          message={message}
          messageTone={status === 'valid' ? 'ok' : status === 'error' ? 'danger' : undefined}
          hint="3–20 · a–z 0–9 _"
          // Inside the pill from `sm` up; on phones it sits full-width below so the input keeps its room.
          trailing={<span className="hidden sm:contents">{action}</span>}
        />
        <div className="grid sm:hidden">{action}</div>
        {connectError && (
          <p className="text-sm font-semibold text-danger" role="alert">
            {connectError}
          </p>
        )}
        {suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink2">Try:</span>
            {suggestions.map((s) => (
              <Button key={s} variant="outline-muted" size={36} onClick={() => setInput(s)}>
                @{s}
              </Button>
            ))}
          </div>
        )}
        {reserved && !registered && (
          <p className="text-[13px] font-semibold text-ink2" aria-live="polite">
            {ready
              ? `Step 2 of 2: @${name} is reserved for this wallet. Register it within 24 hours.`
              : `Step 1 of 2 done: reserved. You can register in ${secondsLeft}s.`}
          </p>
        )}
        {step.kind === 'confirming' && (
          <p className="text-[13px] font-semibold text-ink2" aria-live="polite">
            Waiting for your reservation to confirm on-chain…
          </p>
        )}
        {stepNote && <p className="text-[13px] font-semibold text-ink2">{stepNote}</p>}
        {txLabel && tx.state.status !== 'idle' && (
          <span className="-mb-2 text-[13px] font-semibold text-ink2">{txLabel}</span>
        )}
        <TxStatus state={tx.state} />
        {registered && tx.state.status !== 'failed' && (
          <div className="flex flex-wrap items-center gap-3 rounded-inset-sm bg-ok-bg px-4 py-3 text-sm font-semibold text-ok">
            <span>
              {tx.state.status === 'indexed' ? `@${registered} is yours.` : `Registering @${registered}…`}
            </span>
            {tx.state.status === 'indexed' && (
              <>
                <Button variant="solid" size={36} href="/on-chain/my-names">
                  Set up addresses
                </Button>
                <Button variant="outline" size={36} href={`/on-chain/${registered}`}>
                  View @{registered}
                </Button>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
