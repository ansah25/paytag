'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { api, ApiError, ResolveResponse } from '@/lib/api';

const CHAIN_LABELS: Record<string, string> = {
  ethereum: 'Ethereum',
  solana: 'Solana',
  bitcoin: 'Bitcoin',
};

export function ResolveSearch() {
  const [username, setUsername] = useState('');
  const [result, setResult] = useState<ResolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = username.trim().toLowerCase();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await api.resolve(trimmed);
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err.message : 'Resolution failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="flex gap-3">
        <div className="flex-1 flex items-center bg-panel border border-border rounded-lg px-4 focus-within:border-accent">
          <span className="text-muted mr-1">@</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
            className="flex-1 bg-transparent py-3 outline-none placeholder:text-muted"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <button
          type="submit"
          disabled={loading || !username.trim()}
          className="bg-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium px-6 rounded-lg"
        >
          {loading ? 'Resolving…' : 'Resolve'}
        </button>
      </form>

      {error && (
        <div className="p-4 rounded-lg bg-red-950/40 border border-red-800/50 text-red-200 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-muted text-sm">Addresses for @{result.username}</div>
            {Object.keys(result.addresses).length > 0 && (
              <Link
                href={`/pay/${result.username}`}
                className="text-sm bg-accent hover:opacity-90 text-white font-medium px-4 py-2 rounded-lg"
              >
                Pay @{result.username} →
              </Link>
            )}
          </div>
          {Object.keys(result.addresses).length === 0 ? (
            <div className="p-4 rounded-lg bg-panel border border-border text-muted text-sm">
              No addresses registered yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {Object.entries(result.addresses).map(([chain, address]) => (
                <li
                  key={chain}
                  className="p-4 rounded-lg bg-panel border border-border flex items-center justify-between gap-4"
                >
                  <span className="text-sm text-muted w-24 shrink-0">
                    {CHAIN_LABELS[chain] ?? chain}
                  </span>
                  <span className="font-mono text-sm break-all text-right">{address}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
