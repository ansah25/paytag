'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, ResolveResponse } from '@/lib/api';
import { CopyButton } from './CopyButton';

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
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add address');
    } finally {
      setBusy(false);
    }
  };

  const payLink =
    typeof window !== 'undefined' ? `${window.location.origin}/pay/${username}` : '';

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Share your pay link</h2>
        <div className="p-4 rounded-lg bg-panel border border-border flex items-center justify-between gap-3">
          <span className="font-mono text-sm break-all">{payLink || '/pay/' + username}</span>
          {payLink && <CopyButton value={payLink} />}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Your addresses</h2>
        {!resolution ? (
          <div className="text-muted text-sm">Loading…</div>
        ) : Object.keys(resolution.addresses).length === 0 ? (
          <div className="p-4 rounded-lg bg-panel border border-border text-muted text-sm">
            No addresses yet. Add one below.
          </div>
        ) : (
          <ul className="space-y-2">
            {Object.entries(resolution.addresses).map(([c, addr]) => (
              <li
                key={c}
                className="p-4 rounded-lg bg-panel border border-border flex items-center justify-between gap-4"
              >
                <span className="text-sm text-muted w-24 shrink-0 capitalize">{c}</span>
                <span className="font-mono text-sm break-all text-right">{addr}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Add or update</h2>
        <form onSubmit={onSubmit} className="space-y-3 max-w-xl">
          <div className="flex gap-3">
            <select
              value={chain}
              onChange={(e) => setChain(e.target.value as typeof chain)}
              className="bg-panel border border-border rounded-lg px-3 py-3 outline-none focus:border-accent"
            >
              {CHAINS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Wallet address for selected chain"
              className="flex-1 bg-panel border border-border rounded-lg px-4 py-3 outline-none placeholder:text-muted focus:border-accent font-mono text-sm"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <button
            type="submit"
            disabled={busy || !address.trim()}
            className="bg-accent hover:opacity-90 disabled:opacity-40 text-white font-medium px-6 py-3 rounded-lg"
          >
            {busy ? 'Saving…' : 'Save address'}
          </button>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <p className="text-xs text-muted">
            Adding the same chain twice updates the existing entry.
          </p>
        </form>
      </section>
    </div>
  );
}
