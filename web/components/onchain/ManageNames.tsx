'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { onchainReads, type OwnedName, type PointingName } from '@/lib/onchain/reads';
import { useOnchainTx } from '@/lib/onchain/useOnchainTx';
import { NameCard } from './NameCard';
import { PointedNames } from './PointedNames';
import { WalletBar, useConnectWallet } from './WalletBar';

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; owner: string; names: OwnedName[]; pointing: PointingName[]; primary: string | null }
  | { kind: 'error' };

/** The connected wallet's on-chain names. Reads work on any network; writes need Base Sepolia. */
export function ManageNames() {
  // Only for connection/network state here; each NameCard runs its own writes.
  const { connected, checking, address, wrongNetwork, switchToBase, switching } = useOnchainTx();
  const { connect, connecting, error: connectError } = useConnectWallet();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!address) return;
    const controller = new AbortController();
    // Keep showing the list during a same-account refresh; never show another account's names.
    setLoad((l) => (l.kind === 'ready' && l.owner === address ? l : { kind: 'loading' }));
    // Names that merely point here are a nice-to-have: if that query fails, the section is hidden.
    const pointing = onchainReads.pointingAt(address, controller.signal).catch((err) => {
      if ((err as Error)?.name === 'AbortError') throw err;
      return [] as PointingName[];
    });
    Promise.all([onchainReads.names(address, controller.signal), onchainReads.reverse(address, controller.signal), pointing])
      .then(([owned, rev, points]) => {
        // An account switch aborts this run; never let its late result land on the new account.
        if (controller.signal.aborted) return;
        setLoad({ kind: 'ready', owner: address, names: owned.names, pointing: points, primary: rev.username });
      })
      .catch((err) => {
        if (!controller.signal.aborted && (err as Error)?.name !== 'AbortError') setLoad({ kind: 'error' });
      });
    return () => controller.abort();
  }, [address, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  if (checking) {
    return (
      <Card className="grid gap-3" aria-busy="true">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-3/4" />
      </Card>
    );
  }

  if (!connected || !address) {
    return (
      <Card elevated className="grid justify-items-start gap-4">
        <h2 className="font-display text-[22px] font-semibold">Connect your wallet</h2>
        <p className="text-sm text-ink2">Your on-chain names belong to your wallet. Connect it to manage them. (These are separate from Paytag accounts.)</p>
        <Button size={48} onClick={connect} loading={connecting}>
          Connect wallet
        </Button>
        {connectError && <p className="text-sm font-semibold text-danger">{connectError}</p>}
      </Card>
    );
  }

  return (
    <div className="grid gap-5">
      <WalletBar wrongNetwork={wrongNetwork} switchToBase={switchToBase} switching={switching} />
      {load.kind === 'loading' && (
        <Card className="grid gap-3">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </Card>
      )}
      {load.kind === 'error' && (
        <Card className="grid justify-items-start gap-3">
          <p className="text-sm font-semibold text-danger">Couldn’t load your on-chain names.</p>
          <Button variant="outline" size={40} onClick={refresh}>
            Try again
          </Button>
        </Card>
      )}
      {load.kind === 'ready' && load.names.length === 0 && (
        <Card className="grid justify-items-start gap-3">
          <h2 className="font-display text-[22px] font-semibold">No names yet</h2>
          <p className="text-sm text-ink2">This wallet doesn’t own any on-chain Paytag names.</p>
          <Button size={44} href="/on-chain">
            Register one
          </Button>
        </Card>
      )}
      {load.kind === 'ready' &&
        load.names.map((owned) => (
          <NameCard key={owned.node} owned={owned} account={address} primaryName={load.primary} onChanged={refresh} />
        ))}
      {load.kind === 'ready' && <PointedNames names={load.pointing} primaryName={load.primary} onChanged={refresh} />}
    </div>
  );
}
