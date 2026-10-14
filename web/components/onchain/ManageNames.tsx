'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { indexer, type OwnedName } from '@/lib/onchain/indexer';
import { useOnchainTx } from '@/lib/onchain/useOnchainTx';
import { NameCard } from './NameCard';
import { WalletBar, useConnectWallet } from './WalletBar';

type Load = { kind: 'loading' } | { kind: 'ready'; names: OwnedName[]; primary: string | null } | { kind: 'error' };

/** The connected wallet's names, from the indexer. Reads work on any network; writes need Base Sepolia. */
export function ManageNames() {
  // Only for connection/network state here; each NameCard runs its own writes.
  const { connected, address, wrongNetwork, switchToBase, switching } = useOnchainTx();
  const { connect, connecting, error: connectError } = useConnectWallet();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!address) return;
    const controller = new AbortController();
    setLoad((l) => (l.kind === 'ready' ? l : { kind: 'loading' }));
    Promise.all([indexer.names(address, controller.signal), indexer.reverse(address, controller.signal)])
      .then(([owned, rev]) => setLoad({ kind: 'ready', names: owned.names, primary: rev.username }))
      .catch((err) => {
        if ((err as Error)?.name !== 'AbortError') setLoad({ kind: 'error' });
      });
    return () => controller.abort();
  }, [address, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  if (!connected || !address) {
    return (
      <Card elevated className="grid justify-items-start gap-4">
        <h2 className="font-display text-[22px] font-semibold">Connect your wallet</h2>
        <p className="text-sm text-ink2">Your on-chain names belong to your wallet. Connect it to manage them.</p>
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
          <p className="text-sm font-semibold text-danger">Couldn’t load your names from the indexer.</p>
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
    </div>
  );
}
