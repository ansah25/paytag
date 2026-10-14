'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, type FieldStatus } from '@/components/ui/Field';
import { normalizeName } from '@/lib/onchain/generated/names';
import { RESERVED_NODES } from '@/lib/onchain/generated/reservedNodes';
import { indexer, type Availability } from '@/lib/onchain/indexer';
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

/**
 * Search and register. Format and the reserved list are checked locally (same rules as the
 * contract); "taken" comes from the indexer. If the indexer is down, registering still works:
 * the pre-flight simulation reverts with NameTaken for a taken name.
 */
export function RegisterPanel() {
  const tx = useOnchainTx();
  const { connect, connecting } = useConnectWallet();
  const [input, setInput] = useState('');
  const [check, setCheck] = useState<Check>({ kind: 'empty' });
  const [recheck, setRecheck] = useState(0);
  const [registered, setRegistered] = useState<string | null>(null);

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
  const canRegister =
    !!name && (check.kind === 'unreachable' || (check.kind === 'result' && check.result.available));

  const register = () => {
    if (!name) return;
    setRegistered(null);
    tx.run(
      { kind: 'register', name },
      {
        context: { name },
        // Optimistic: the name reads as registered as soon as the tx is broadcast…
        onSubmitted: () => setRegistered(name),
        // …and is rolled back with the reason if anything fails.
        onFailed: () => {
          setRegistered(null);
          setRecheck((n) => n + 1);
        },
        onIndexed: () => setRecheck((n) => n + 1),
      },
    );
  };

  const status: FieldStatus =
    check.kind === 'checking'
      ? 'checking'
      : check.kind === 'invalid' || check.kind === 'reserved' || (check.kind === 'result' && !check.result.available)
        ? 'error'
        : check.kind === 'result'
          ? 'valid'
          : 'idle';

  const message = (() => {
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

  const suggestions = check.kind === 'result' ? check.result.suggestions : [];
  const action = !tx.connected ? (
    <Button size={48} onClick={connect} loading={connecting}>
      Connect wallet
    </Button>
  ) : tx.wrongNetwork ? (
    <Button size={48} onClick={() => tx.switchToBase().catch(() => {})} loading={tx.switching}>
      Switch network
    </Button>
  ) : (
    <Button size={48} onClick={register} disabled={!canRegister || tx.busy} loading={tx.busy} loadingLabel="Registering…">
      Register
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
            addresses.
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
          onKeyDown={(e) => e.key === 'Enter' && canRegister && tx.connected && !tx.wrongNetwork && !tx.busy && register()}
          disabled={tx.busy}
          status={status}
          message={message}
          messageTone={status === 'valid' ? 'ok' : status === 'error' ? 'danger' : undefined}
          hint="3–20 · a–z 0–9 _"
          // Inside the pill from `sm` up; on phones it sits full-width below so the input keeps its room.
          trailing={<span className="hidden sm:contents">{action}</span>}
        />
        <div className="grid sm:hidden">{action}</div>
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
        <TxStatus state={tx.state} />
        {registered && tx.state.status !== 'failed' && (
          <div className="flex flex-wrap items-center gap-3 rounded-inset-sm bg-ok-bg px-4 py-3 text-sm font-semibold text-ok">
            <span>
              {tx.state.status === 'indexed' ? `@${registered} is yours.` : `Registering @${registered}…`}
            </span>
            {tx.state.status === 'indexed' && (
              <>
                <Button variant="solid" size={36} href="/on-chain/manage">
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
