'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, ResolveResponse } from '@/lib/api';
import { ChainGlyph } from './ChainGlyph';

const CHAINS = [
  { value: 'ethereum', label: 'Ethereum' },
  { value: 'solana', label: 'Solana' },
  { value: 'bitcoin', label: 'Bitcoin' },
] as const;

interface Props {
  username: string;
}

export function AddressManager({ username }: Props) {
  const [resolution, setResolution] = useState<ResolveResponse | null>(null);
  const [chain, setChain] = useState<(typeof CHAINS)[number]['value']>('ethereum');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setResolution(await api.resolve(username));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load addresses');
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.addAddress(chain, address.trim());
      setAddress('');
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save address');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (c: string, current: string) => {
    setChain(c as typeof chain);
    setAddress(current);
    setEditing(c);
    setError(null);
  };

  return (
    <div>
      {!resolution ? (
        <div className="text-sm text-ink-3 py-4">Loading…</div>
      ) : (
        <div className="card divide-y divide-hairline">
          {CHAINS.map((c) => {
            const addr = resolution.addresses[c.value];
            const isOpen = editing === c.value;
            return (
              <div key={c.value}>
                <div className="flex items-center gap-4 px-5 py-4">
                  <ChainGlyph chain={c.value} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-ink">{c.label}</div>
                    {addr ? (
                      <div className="font-mono text-[13px] text-ink-3 break-all numeric mt-0.5">
                        {addr}
                      </div>
                    ) : (
                      <div className="text-[13px] text-ink-4 italic mt-0.5">
                        No address mapped yet
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() =>
                      isOpen ? setEditing(null) : startEdit(c.value, addr ?? '')
                    }
                    className="btn-bare !py-2 !px-4 !text-[13px] shrink-0"
                  >
                    {isOpen ? 'Cancel' : addr ? 'Edit' : 'Add'}
                  </button>
                </div>
                {isOpen && (
                  <form
                    onSubmit={onSubmit}
                    className="px-5 pb-5 pt-1 grid grid-cols-12 gap-3 items-end bg-paper/50"
                  >
                    <div className="col-span-12 md:col-span-9">
                      <label className="eyebrow-muted block mb-2">
                        {addr ? 'Update' : 'Add'} {c.label} address
                      </label>
                      <input
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="Wallet address"
                        className="field field-mono"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        autoFocus
                      />
                    </div>
                    <div className="col-span-12 md:col-span-3 flex gap-2 md:justify-end">
                      <button
                        type="submit"
                        disabled={busy || !address.trim()}
                        className="btn-primary !text-sm"
                      >
                        <span>{busy ? 'Saving…' : 'Save'}</span>
                      </button>
                    </div>
                    {error && (
                      <p className="col-span-12 text-sm text-danger">{error}</p>
                    )}
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
