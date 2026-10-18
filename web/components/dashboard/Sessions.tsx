'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { api, type SessionInfo } from '@/lib/api';
import { shortAddress } from '@/lib/format';

interface Props {
  wallet: string;
  onSignOut: () => Promise<void>;
}

export function Sessions({ wallet, onSignOut }: Props) {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [allError, setAllError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .sessions()
      .then((result) => !cancelled && setSessions(result))
      .catch(() => !cancelled && setSessions([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // Revokes every token for the account on the server, then clears this browser too.
  const signOutEverywhere = async () => {
    setSigningOutAll(true);
    setAllError(null);
    try {
      await api.logoutAll();
    } catch {
      setAllError('Couldn’t sign out other sessions. Try again.');
      setSigningOutAll(false);
      return;
    }
    // Every session is revoked now, this one included; clearing this browser is all that's left.
    try {
      await onSignOut();
    } finally {
      setSigningOutAll(false);
    }
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="max-w-[640px]">
      <Card className="grid content-start gap-4">
        <div>
          <div className="text-[13px] font-semibold text-accent">Security</div>
          <h2 className="mt-1.5 font-display text-[26px] font-semibold tracking-display-md">Signed-in sessions</h2>
        </div>

        <ul className="grid">
          {sessions === null ? (
            <li className="grid gap-2 border-t border-line py-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3.5 w-56" delay={100} />
            </li>
          ) : (
            sessions.map((session) => (
              <li key={session.id} className="flex items-center justify-between gap-3 border-t border-line py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                    {session.device}
                    {session.current && (
                      <Badge size="sm" tone="ok">
                        This device
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 text-[13px] text-ink3">
                    {session.meta} · {shortAddress(wallet)}
                  </div>
                </div>
              </li>
            ))
          )}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span className="max-w-[360px] text-[13px] leading-[1.5] text-ink3">
            Sessions are signatures, not passwords, and last up to 24 hours. Sign out clears this browser. Sign out
            everywhere also ends every other session for this account, e.g. on a lost device.
          </span>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger-outline" loading={signingOut} loadingLabel="Signing out…" onClick={() => void signOut()}>
              Sign out
            </Button>
            <Button
              variant="danger-outline"
              loading={signingOutAll}
              loadingLabel="Signing out…"
              onClick={() => void signOutEverywhere()}
            >
              Sign out everywhere
            </Button>
          </div>
        </div>
        {allError && (
          <p role="alert" className="text-sm font-medium text-danger">
            {allError}
          </p>
        )}
      </Card>
    </div>
  );
}
