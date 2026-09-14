'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChainDot } from '@/components/ui/ChainDot';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { api, ApiError } from '@/lib/api';
import type { PaytagChain } from '@/lib/chains';
import { withArticle } from '@/lib/format';
import { walletErrorMessage } from '@/lib/pay/errors';
import { CHAIN_META, CHAIN_ORDER } from '@/lib/pay/meta';
import { canVerifyChain, useAddressSigner, VerifyError } from '@/lib/verify';

// Mirrors the server's validators (src/services/walletService.ts).
const ADDRESS_META: Record<PaytagChain, { placeholder: string; help: string; pattern: RegExp }> = {
  ethereum: {
    placeholder: '0x…',
    help: 'An EVM address (0x + 40 hex chars). ENS names aren’t resolved yet.',
    pattern: /^0x[0-9a-fA-F]{40}$/,
  },
  solana: {
    placeholder: 'Base58 address',
    help: 'A Solana public key, 32–44 base58 characters.',
    pattern: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  },
  bitcoin: {
    placeholder: 'bc1…',
    help: 'A bech32 (bc1…) or legacy (1…/3…) address.',
    pattern: /^([13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[ac-hj-np-z02-9]{8,87})$/i,
  },
};

const sameAddress = (chain: PaytagChain, a: string, b?: string) =>
  !!b && (chain === 'ethereum' ? a.toLowerCase() === b.toLowerCase() : a === b);

type Mode = { kind: 'idle' } | { kind: 'editing'; chain: PaytagChain } | { kind: 'confirming'; chain: PaytagChain };

interface Props {
  addresses: Partial<Record<PaytagChain, string>>;
  verified: Partial<Record<PaytagChain, boolean>>;
  loading: boolean;
  onChanged: () => Promise<void>;
}

const ROW_PADDING = 'px-[clamp(22px,3vw,32px)]';

export function AddressManager({ addresses, verified, loading, onChanged }: Props) {
  const toast = useToast();
  const signWith = useAddressSigner();
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [verifying, setVerifying] = useState<PaytagChain | null>(null);
  const [rowError, setRowError] = useState<{ chain: PaytagChain; message: string } | null>(null);

  const activeCount = CHAIN_ORDER.filter((c) => addresses[c]).length;

  const startEdit = (chain: PaytagChain) => {
    setMode({ kind: 'editing', chain });
    setDraft(addresses[chain] ?? '');
    setSaveError(null);
    setRowError(null);
  };

  const reset = () => {
    setMode({ kind: 'idle' });
    setSaveError(null);
  };

  const save = async (e: FormEvent, chain: PaytagChain) => {
    e.preventDefault();
    const value = draft.trim();
    const label = CHAIN_META[chain].label;
    if (!ADDRESS_META[chain].pattern.test(value)) {
      setSaveError(`That doesn’t look like ${withArticle(label)} address.`);
      return;
    }
    if (sameAddress(chain, value, addresses[chain])) {
      reset();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await api.addAddress(chain, value);
      await onChanged();
      reset();
      toast(`${label} address saved`);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Couldn’t save the address.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (chain: PaytagChain) => {
    const label = CHAIN_META[chain].label;
    setRemoving(true);
    try {
      await api.removeAddress(chain);
      await onChanged();
      toast(`${label} address removed`);
    } catch (err) {
      setRowError({ chain, message: err instanceof ApiError ? err.message : 'Couldn’t remove the address.' });
    } finally {
      setRemoving(false);
      setMode({ kind: 'idle' });
    }
  };

  const verify = async (chain: PaytagChain) => {
    const address = addresses[chain];
    if (!address) return;
    const label = CHAIN_META[chain].label;
    setVerifying(chain);
    setRowError(null);
    try {
      const { message } = await api.verifyAddressChallenge(chain);
      const signature = await signWith(chain, address, message);
      await api.verifyAddress(chain, signature);
      await onChanged();
      toast(`${label} wallet verified`);
    } catch (err) {
      setRowError({
        chain,
        message:
          err instanceof ApiError || err instanceof VerifyError
            ? err.message
            : walletErrorMessage(err, {
                rejected: 'Signature was rejected. Nothing was changed.',
                fallback: 'Verification didn’t go through.',
              }),
      });
    } finally {
      setVerifying(null);
    }
  };

  return (
    <Card padding="none" as="section" aria-labelledby="wallets-title" className="overflow-hidden">
      <div className={`flex flex-wrap items-baseline justify-between gap-3 pb-2 pt-6 ${ROW_PADDING}`}>
        <div>
          <div className="text-[13px] font-semibold text-accent">Wallets</div>
          <h2 id="wallets-title" className="mt-1.5 font-display text-[26px] font-semibold tracking-display-md">
            Mapped addresses
          </h2>
        </div>
        {!loading && <span className="text-[13px] text-ink2">{activeCount} of 3 active</span>}
      </div>

      {CHAIN_ORDER.map((chain, index) => {
        if (loading) {
          return (
            <div key={chain} className={`flex items-center gap-3.5 border-t border-line py-[18px] ${ROW_PADDING}`}>
              <Skeleton shape="circle" className="h-9 w-9 shrink-0" delay={index * 100} />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-4 w-24" delay={index * 100} />
                <Skeleton className="h-3.5 w-3/5" delay={index * 100 + 100} />
              </div>
            </div>
          );
        }

        const meta = CHAIN_META[chain];
        const address = addresses[chain];
        const isVerified = !!verified[chain];
        const editing = mode.kind === 'editing' && mode.chain === chain;
        const confirming = mode.kind === 'confirming' && mode.chain === chain;
        const busyHere = verifying === chain;
        const inputId = `address-${chain}`;

        return (
          <div key={chain} className="border-t border-line">
            <div className={`flex flex-wrap items-center gap-3.5 py-[18px] ${ROW_PADDING}`}>
              <span
                aria-hidden
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface2"
              >
                <ChainDot chain={chain} size={10} />
              </span>
              <div className="min-w-[200px] flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-bold">{meta.label}</span>
                  {address && (
                    <Badge size="sm" tone={isVerified ? 'ok' : 'muted'}>
                      {isVerified ? 'Verified' : 'Unverified'}
                    </Badge>
                  )}
                </div>
                {address ? (
                  <div className="mt-0.5 break-all font-mono text-[13px] text-ink2">{address}</div>
                ) : (
                  <div className="mt-0.5 text-[13px] italic text-ink3">No address mapped yet</div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {confirming ? (
                  <>
                    <span className="mr-1.5 text-[13px] text-ink2">Remove {meta.label}?</span>
                    <Button
                      variant="danger"
                      size={40}
                      loading={removing}
                      loadingLabel="Removing…"
                      onClick={() => void remove(chain)}
                    >
                      Remove
                    </Button>
                    <Button variant="outline-muted" size={40} disabled={removing} onClick={reset}>
                      Keep
                    </Button>
                  </>
                ) : editing ? (
                  <Button variant="outline-muted" size={40} disabled={saving} onClick={reset}>
                    Cancel
                  </Button>
                ) : (
                  <>
                    {address && !isVerified && canVerifyChain(chain) && (
                      <Button
                        size={40}
                        loading={busyHere}
                        loadingLabel="Waiting for signature…"
                        disabled={verifying !== null}
                        onClick={() => void verify(chain)}
                      >
                        Verify by signing
                      </Button>
                    )}
                    {address && !isVerified && !canVerifyChain(chain) && (
                      <span className="mr-1.5 text-[13px] text-ink3">Verification coming soon</span>
                    )}
                    {address && (
                      <Button
                        variant="outline-destructive"
                        size={40}
                        disabled={busyHere}
                        onClick={() => {
                          setRowError(null);
                          setMode({ kind: 'confirming', chain });
                        }}
                      >
                        Remove
                      </Button>
                    )}
                    <Button variant="outline" size={40} disabled={busyHere} onClick={() => startEdit(chain)}>
                      {address ? 'Edit' : 'Add'}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {rowError?.chain === chain && !editing && (
              <p role="alert" className={`-mt-2 pb-4 text-[13px] font-semibold text-danger ${ROW_PADDING}`}>
                {rowError.message}
              </p>
            )}

            {editing && (
              <form onSubmit={(e) => void save(e, chain)} className={`grid gap-2.5 pb-5 ${ROW_PADDING}`}>
                <div className="flex flex-wrap gap-2">
                  <Field
                    id={inputId}
                    shape="inset"
                    mono
                    wrapperClassName="min-w-[min(240px,100%)] flex-1"
                    aria-label={`${meta.label} address`}
                    placeholder={ADDRESS_META[chain].placeholder}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setSaveError(null);
                    }}
                    status={saveError ? 'error' : 'idle'}
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                  />
                  <Button type="submit" size={48} loading={saving} loadingLabel="Saving…" disabled={!draft.trim()}>
                    Save
                  </Button>
                </div>
                {saveError && (
                  <div role="alert" className="text-[13px] font-semibold text-danger">
                    {saveError}
                  </div>
                )}
                <div className="text-[13px] text-ink3">{ADDRESS_META[chain].help}</div>
              </form>
            )}
          </div>
        );
      })}
    </Card>
  );
}
