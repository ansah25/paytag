'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { useAccount } from 'wagmi';
import type { PaytagChain } from '@/lib/chains';
import { cx } from '@/lib/cx';
import { CHAIN_META, CHAIN_ORDER } from '@/lib/pay/meta';
import { syncPhantomSession, useSessionWallets } from '@/lib/pay/session';
import type { PayFlowProps } from '@/lib/pay/types';
import { Card } from './ui/Card';
import { ChainDot } from './ui/ChainDot';
import { SegmentedRail } from './ui/SegmentedRail';
import { Skeleton } from './ui/Skeleton';
import { StripedPlaceholder } from './ui/StripedPlaceholder';

function FlowLoading() {
  return (
    <div aria-hidden className="grid gap-[22px]">
      <Skeleton className="h-7 w-3/5" />
      <Skeleton shape="block" className="h-[62px]" delay={100} />
      <Skeleton shape="block" className="h-[180px]" delay={200} />
    </div>
  );
}

// Each chain flow pulls its own SDK (@solana/web3.js, sats-connect), so only
// the picked chain's code is downloaded.
const FLOWS: Record<PaytagChain, ComponentType<PayFlowProps>> = {
  ethereum: dynamic(() => import('./pay/EvmPayFlow'), { ssr: false, loading: FlowLoading }),
  solana: dynamic(() => import('./pay/SolanaPayFlow'), { ssr: false, loading: FlowLoading }),
  bitcoin: dynamic(() => import('./pay/BitcoinPayFlow'), { ssr: false, loading: FlowLoading }),
};

export interface PayPanelProps {
  username: string;
  chains: PaytagChain[];
  addresses: Partial<Record<PaytagChain, string>>;
  verified?: Partial<Record<PaytagChain, boolean>>;
  /** Hide "View profile →" in the empty state (when already on the profile). */
  hideProfileLink?: boolean;
  className?: string;
}

export function PayPanel({
  username,
  chains,
  addresses,
  verified = {},
  hideProfileLink = false,
  className,
}: PayPanelProps) {
  const available = CHAIN_ORDER.filter((c) => chains.includes(c) && !!addresses[c]);
  const [picked, setPicked] = useState<PaytagChain | null>(null);
  const [busy, setBusy] = useState(false);
  const chain = picked && available.includes(picked) ? picked : available[0] ?? null;

  const { status: evmStatus } = useAccount();
  const sessionWallets = useSessionWallets();
  useEffect(() => {
    syncPhantomSession();
  }, []);

  if (!chain) {
    return (
      <Card padding="none" className={cx('grid gap-[22px] p-7', className)}>
        <h2 className="break-words font-display text-xl font-semibold tracking-display">Pay @{username}</h2>
        <div className="grid animate-stage justify-items-center gap-3.5 pb-1 pt-4 text-center">
          <StripedPlaceholder className="h-20 w-[120px]" />
          <p className="max-w-[360px] text-[15px] leading-[1.55] text-ink2">
            @{username} hasn’t added any addresses yet, so there’s nowhere to send.
            {!hideProfileLink && (
              <>
                {' '}
                <Link href={`/${username}`} className="font-semibold text-accent">
                  View profile →
                </Link>
              </>
            )}
          </p>
        </div>
      </Card>
    );
  }

  const isConnected = (c: PaytagChain) =>
    c === 'ethereum' ? evmStatus === 'connected' : !!sessionWallets[c];
  const otherChain = available.find((c) => c !== chain && isConnected(c));
  const Flow = FLOWS[chain];

  return (
    <div className={cx('grid min-w-0 gap-3.5', className)}>
      {available.length > 1 && (
        <SegmentedRail
          label="Pay with"
          size={44}
          fill
          value={chain}
          onChange={setPicked}
          disabled={busy}
          items={available.map((c) => ({
            id: c,
            label: (
              <>
                <ChainDot chain={c} size={8} />
                {CHAIN_META[c].label}
                <span className="font-mono text-xs font-medium text-ink3 max-[480px]:hidden">
                  {CHAIN_META[c].symbol}
                </span>
              </>
            ),
          }))}
        />
      )}
      <Card padding="none" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-[22px] p-7">
        <Flow
          key={chain}
          username={username}
          recipient={addresses[chain] ?? ''}
          verified={!!verified[chain]}
          otherWallet={otherChain ? { chain: otherChain } : null}
          onSwitchChain={setPicked}
          onBusyChange={setBusy}
        />
      </Card>
    </div>
  );
}
