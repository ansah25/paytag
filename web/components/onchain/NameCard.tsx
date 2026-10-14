'use client';

import type { OnchainResolveResponse } from '@paytagdev/sdk';
import { useCallback, useEffect, useState } from 'react';
import { zeroHash, type Address, type Hex } from 'viem';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChainDot } from '@/components/ui/ChainDot';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { encodeAddress, isEvmCoinType } from '@/lib/onchain/generated/codec';
import { indexer, type OwnedName } from '@/lib/onchain/indexer';
import { RECORD_SLOTS, type RecordSlot } from '@/lib/onchain/records';
import { useOnchainTx } from '@/lib/onchain/useOnchainTx';
import { TxStatus } from './TxStatus';

/** A record change shown before the indexer confirms it. `value` null = being cleared. */
type Overlay = { value: string | null; phase: 'pending' | 'confirmed' };

const ZERO_ADDRESS_HEX = `0x${'0'.repeat(40)}`;

/**
 * One owned name: its records (editable), primary-name control, and transfer. Every write goes
 * through useOnchainTx; record edits are optimistic and roll back with the decoded reason.
 */
export function NameCard({
  owned,
  account,
  primaryName,
  onChanged,
}: {
  owned: OwnedName;
  account: Address;
  primaryName: string | null;
  /** Ownership or primary name changed: the parent refetches its lists. */
  onChanged: () => void;
}) {
  const tx = useOnchainTx();
  const name = owned.name;
  const [data, setData] = useState<OnchainResolveResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [overlay, setOverlay] = useState<Record<string, Overlay>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState('');
  const [transferAck, setTransferAck] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [action, setAction] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);
    indexer
      .resolve(name, controller.signal)
      .then((d) => setData(d))
      .catch((err) => {
        if ((err as Error)?.name !== 'AbortError') setLoadError(true);
      });
    return () => controller.abort();
  }, [name, reload]);

  const refetch = useCallback(() => setReload((n) => n + 1), []);

  // A "confirmed" overlay (write final on-chain, indexer was slow) stays until fresh data shows
  // the same value, so a successful write never appears to revert.
  useEffect(() => {
    if (!data) return;
    setOverlay((o) => {
      const next = { ...o };
      for (const [key, entry] of Object.entries(o)) {
        if (entry.phase !== 'confirmed') continue;
        const record = data.records.find((r) => r.coinType === key);
        const current = record?.address ?? null;
        // Same value written by a previous owner (stale) doesn't count: that's the pre-write row.
        const matches = (current?.toLowerCase() ?? null) === (entry.value?.toLowerCase() ?? null) && !record?.stale;
        if (matches) delete next[key];
      }
      return next;
    });
  }, [data]);

  // While any confirmed write is still unreflected, keep re-reading every 10s until it is.
  const awaitingIndexer = Object.values(overlay).some((o) => o.phase === 'confirmed');
  useEffect(() => {
    if (!awaitingIndexer) return;
    const timer = setTimeout(refetch, 10_000);
    return () => clearTimeout(timer);
  }, [awaitingIndexer, data, refetch]);
  const record = (slot: RecordSlot) => data?.records.find((r) => r.coinType === slot.coinType.toString());

  const ethRecord = data?.records.find((r) => r.coinType === '60');
  const ethPointsHere = !!ethRecord?.address && !ethRecord.stale && ethRecord.address.toLowerCase() === account.toLowerCase();
  const isPrimary = primaryName === name;

  const startEdit = (slot: RecordSlot) => {
    tx.reset();
    setEditing(slot.coinType.toString());
    setDraft(record(slot)?.address ?? '');
    setFieldError(null);
  };

  const saveRecord = (slot: RecordSlot, clear = false) => {
    if (tx.busy || tx.wrongNetwork) return;
    const key = slot.coinType.toString();
    const input = clear ? '' : draft.trim();
    if (!clear && !input) return; // an emptied field never clears; Clear is explicit
    let value: Hex = '0x';
    if (input) {
      try {
        value = encodeAddress(slot.coinType, input);
      } catch {
        return setFieldError(`That isn’t a valid ${slot.label} address.`);
      }
      // The contract only refuses it for ETH; for any EVM chain it would send payments to nobody.
      if (isEvmCoinType(slot.coinType) && value === ZERO_ADDRESS_HEX) {
        return setFieldError('The zero address can’t be used. Clear the record instead.');
      }
    }
    setFieldError(null);
    setAction(clear ? `Clearing ${slot.label}` : `Saving ${slot.label}`);
    tx.run(
      { kind: 'setRecord', node: owned.node, coinType: slot.coinType, value },
      {
        context: { name },
        onSubmitted: () => {
          setEditing(null);
          setOverlay((o) => ({ ...o, [key]: { value: input || null, phase: 'pending' } }));
        },
        onConfirmed: () => setOverlay((o) => ({ ...o, [key]: { value: input || null, phase: 'confirmed' } })),
        onFailed: () =>
          setOverlay((o) => {
            const { [key]: _rolledBack, ...rest } = o;
            return rest;
          }),
        onIndexed: (caughtUp) => {
          if (caughtUp) {
            setOverlay((o) => {
              const { [key]: _done, ...rest } = o;
              return rest;
            });
            refetch();
          }
          // Otherwise the write is final on-chain but the indexer lagged: the overlay stays
          // ("Confirmed, updating") and the polling effect above re-reads until data agrees.
          if (slot.coinType === 60n) onChanged(); // primary-name eligibility may have changed
        },
      },
    );
  };

  const setPrimary = (clear: boolean) => {
    if (tx.busy || tx.wrongNetwork) return;
    setAction(clear ? 'Clearing primary name' : 'Setting primary name');
    tx.run({ kind: 'setReverse', node: clear ? zeroHash : owned.node }, { context: { name }, onIndexed: () => onChanged() });
  };

  const transfer = () => {
    if (tx.busy || tx.wrongNetwork) return;
    let to: Address;
    try {
      to = encodeAddress(60n, transferTo.trim()) as Address;
    } catch {
      return setTransferError('Enter a valid Ethereum address (checksummed or all lowercase).');
    }
    if (to.toLowerCase() === account.toLowerCase()) return setTransferError('That’s your own address.');
    setTransferError(null);
    setAction('Transferring');
    tx.run(
      { kind: 'transfer', node: owned.node, to },
      {
        context: { name },
        onSubmitted: () => setTransferring(true),
        onFailed: () => setTransferring(false),
        onIndexed: () => onChanged(), // the name leaves this wallet's list
      },
    );
  };

  return (
    <Card className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <a href={`/on-chain/${name}`} className="break-all font-display text-[26px] font-semibold leading-none hover:underline">
            @{name}
          </a>
          {isPrimary && <Badge>Primary name</Badge>}
          {transferring && <Badge tone="warn">Transferring…</Badge>}
        </div>
        <span className="text-[13px] text-ink2">
          Registered {new Date(owned.registeredAt * 1000).toLocaleDateString()}
        </span>
      </div>

      {action && tx.state.status !== 'idle' && (
        <div className="grid gap-1.5">
          <span className="text-[13px] font-semibold text-ink2">{action}</span>
          <TxStatus state={tx.state} />
        </div>
      )}

      <div className="grid">
        {RECORD_SLOTS.map((slot) => {
          const key = slot.coinType.toString();
          const r = record(slot);
          const o = overlay[key];
          const shown = o ? o.value : (r?.address ?? r?.value ?? null);
          return (
            <div key={key} className="grid gap-2 border-t border-line py-3 first:border-t-0">
              <div className="flex flex-wrap items-center gap-3">
                {slot.chain ? <ChainDot chain={slot.chain} muted={!shown} /> : <span className="h-2.5 w-2.5 rounded-full bg-ink3" aria-hidden />}
                <span className="w-20 shrink-0 text-sm font-semibold">{slot.label}</span>
                {!data && !loadError ? (
                  <Skeleton className="h-4 w-48" />
                ) : (
                  <span className={`order-last min-w-0 basis-full break-all font-mono text-[13px] sm:order-none sm:basis-0 sm:flex-1 ${shown ? 'text-ink' : 'text-ink3'}`}>
                    {shown ?? 'Not set'}
                  </span>
                )}
                {o && <Badge tone="muted">{o.phase === 'pending' ? 'Pending' : 'Confirmed, updating'}</Badge>}
                {!o && r?.stale && <Badge tone="warn">Set by previous owner</Badge>}
                {editing !== key && (
                  <span className="flex gap-2">
                    <Button variant="outline-muted" size={36} onClick={() => startEdit(slot)} disabled={tx.busy || !data}>
                      {r ? 'Edit' : 'Add'}
                    </Button>
                    {r && (
                      <Button
                        variant="outline-destructive"
                        size={36}
                        onClick={() => saveRecord(slot, true)}
                        disabled={tx.busy || tx.wrongNetwork}
                      >
                        Clear
                      </Button>
                    )}
                  </span>
                )}
              </div>
              {editing === key && (
                <Field
                  shape="inset"
                  mono
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={`${slot.label} address`}
                  placeholder={slot.placeholder}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setFieldError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRecord(slot);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  status={fieldError ? 'error' : 'idle'}
                  message={fieldError ?? undefined}
                  messageTone="danger"
                  trailing={
                    <span className="flex gap-2">
                      <Button variant="ghost" size={36} onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                      <Button
                        variant="solid"
                        size={36}
                        onClick={() => saveRecord(slot)}
                        disabled={!draft.trim() || tx.busy || tx.wrongNetwork}
                      >
                        Save
                      </Button>
                    </span>
                  }
                />
              )}
            </div>
          );
        })}
        {loadError && (
          <p className="text-sm font-semibold text-danger">
            Couldn’t load records.{' '}
            <button className="underline" onClick={refetch}>
              Retry
            </button>
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {isPrimary ? (
          <Button variant="outline-muted" size={40} onClick={() => setPrimary(true)} disabled={tx.busy || tx.wrongNetwork}>
            Stop using as primary name
          </Button>
        ) : (
          <Button variant="outline" size={40} onClick={() => setPrimary(false)} disabled={!ethPointsHere || tx.busy || tx.wrongNetwork}>
            Make primary name
          </Button>
        )}
        {!isPrimary && !ethPointsHere && data && (
          <span className="text-[13px] text-ink2">Set the Ethereum record to your connected wallet first.</span>
        )}
        <Button
          variant="ghost"
          size={40}
          className="ml-auto"
          onClick={() => setTransferOpen((v) => !v)}
          disabled={tx.busy}
          aria-expanded={transferOpen}
        >
          Transfer…
        </Button>
      </div>

      {transferOpen && (
        <div className="grid gap-3 rounded-inset-sm bg-surface2 p-4">
          <Field
            shape="inset"
            surface="surface"
            mono
            autoComplete="off"
            spellCheck={false}
            label="New owner"
            placeholder="0x…"
            value={transferTo}
            onChange={(e) => {
              setTransferTo(e.target.value);
              setTransferError(null);
            }}
            status={transferError ? 'error' : 'idle'}
            message={transferError ?? undefined}
            messageTone="danger"
          />
          <label className="flex items-start gap-2.5 text-sm text-ink2">
            <input type="checkbox" className="mt-1" checked={transferAck} onChange={(e) => setTransferAck(e.target.checked)} />
            <span>
              I understand this can’t be undone from this wallet, and the new owner must re-set the records: the current
              ones will be marked as set by a previous owner and stop being used for payments.
            </span>
          </label>
          <Button
            variant="danger"
            size={44}
            onClick={transfer}
            disabled={!transferAck || !transferTo.trim() || tx.busy || tx.wrongNetwork}
          >
            Transfer @{name}
          </Button>
        </div>
      )}
    </Card>
  );
}
