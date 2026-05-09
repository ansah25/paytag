'use client';

import { FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { updateAuth } from '@/lib/auth';

interface Props {
  onRegistered: (username: string) => void;
}

export function RegisterForm({ onRegistered }: Props) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.register(username.trim().toLowerCase());
      updateAuth({ username: result.username });
      onRegistered(result.username);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-ink-2 text-sm">
        Pick a username. 3 to 20 lowercase letters, numbers, or underscores.
      </p>
      <div className="flex items-center gap-2 bg-white border-2 border-hairline focus-within:border-primary focus-within:shadow-[0_0_0_4px_rgba(84,105,212,0.15)] rounded-2xl px-5 py-3 transition-all">
        <span
          className="font-display font-bold text-2xl select-none"
          style={{
            backgroundImage:
              'linear-gradient(135deg, #5469D4 0%, #7E5CFF 50%, #FF5A6E 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          @
        </span>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          placeholder="yourname"
          className="flex-1 bg-transparent border-0 outline-none text-xl font-display font-semibold text-ink placeholder:text-ink-4/60"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      <button
        type="submit"
        disabled={busy || !username.trim()}
        className="btn-primary"
      >
        <span>{busy ? 'Registering…' : 'Register'}</span>
      </button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  );
}
