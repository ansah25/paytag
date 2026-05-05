'use client';

import { FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { updateAuth } from '@/lib/auth';

interface Props {
  wallet: string;
  onClaimed: (username: string) => void;
}

export function ClaimUsername({ wallet, onClaimed }: Props) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await api.resolve(username.trim().toLowerCase());
      void wallet;
      updateAuth({ username: data.username });
      onClaimed(data.username);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Username not found');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-ink-2 text-sm">
        Already registered on another device? Enter your username to load your dashboard.
      </p>
      <div className="flex items-center gap-2 bg-white border border-hairline focus-within:border-primary focus-within:shadow-[0_0_0_4px_rgba(84,105,212,0.15)] rounded-xl px-4 py-2 transition-all">
        <span className="text-primary font-display font-bold text-xl">@</span>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          placeholder="yourname"
          className="flex-1 bg-transparent border-0 outline-none text-base font-display font-semibold text-ink placeholder:text-ink-4/60"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="submit" disabled={busy || !username.trim()} className="btn-quiet">
          {busy ? 'Loading…' : 'Load'}
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  );
}
