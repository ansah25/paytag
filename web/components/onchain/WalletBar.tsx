'use client';

import { useState } from 'react';
import { useConnect, useDisconnect } from 'wagmi';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { shortAddress } from '@/lib/format';
import { walletErrorMessage } from '@/lib/pay/errors';
import { useHydratedAccount } from '@/lib/onchain/useHydratedAccount';
import { ONCHAIN_CHAIN } from '@/lib/onchain/useOnchainTx';

const NO_WALLET = 'No browser wallet detected. Install MetaMask, Rabby or another browser wallet.';

/** Connect a wallet, asking for Base Sepolia at connect time. */
export function useConnectWallet() {
  const { connectors, connectAsync } = useConnect();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setError(null);
    const injected = connectors.find((c) => c.type === 'injected') ?? connectors[0];
    if (!injected) return setError(NO_WALLET);
    setConnecting(true);
    try {
      await connectAsync({ connector: injected, chainId: ONCHAIN_CHAIN.id });
    } catch (err) {
      setError(
        walletErrorMessage(err, {
          rejected: 'Connection was rejected in the wallet.',
          notFound: NO_WALLET,
          fallback: 'Couldn’t connect to your wallet.',
        }),
      );
    } finally {
      setConnecting(false);
    }
  };

  return { connect, connecting, error };
}

/**
 * Network label + wallet state for the on-chain pages: connect button when disconnected, the
 * connected address otherwise, and a switch prompt whenever the wallet is off Base Sepolia.
 */
export function WalletBar({
  wrongNetwork,
  switchToBase,
  switching,
}: {
  wrongNetwork: boolean;
  switchToBase: () => Promise<unknown>;
  switching: boolean;
}) {
  const { address, status } = useHydratedAccount();
  const { disconnect } = useDisconnect();
  const { connect, connecting, error } = useConnectWallet();
  const [switchError, setSwitchError] = useState<string | null>(null);
  const connected = status === 'connected' && !!address;

  const onSwitch = () => {
    setSwitchError(null);
    switchToBase().catch((err) =>
      setSwitchError(
        walletErrorMessage(err, {
          rejected: 'Network switch was rejected in the wallet.',
          fallback: 'Couldn’t switch networks. Switch to Base Sepolia in your wallet.',
        }),
      ),
    );
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[12px] uppercase tracking-kicker text-ink2">
          Base Sepolia · on-chain beta · separate from Paytag accounts
        </span>
        {connected ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="font-mono text-ink2" title={address}>
              {shortAddress(address)}
            </span>
            <Button variant="outline-destructive" size={36} onClick={() => disconnect()}>
              Disconnect
            </Button>
          </span>
        ) : (
          <Button variant="outline" size={36} onClick={connect} loading={connecting} disabled={status === 'reconnecting'}>
            Connect wallet
          </Button>
        )}
      </div>
      {error && (
        <Notice tone="danger" size="sm" role="alert">
          {error}
        </Notice>
      )}
      {connected && wrongNetwork && (
        <Notice tone="warn" size="sm" className="flex flex-wrap items-center justify-between gap-3">
          <span>Your wallet is on another network. Paytag names live on Base Sepolia.</span>
          <Button variant="solid" size={36} onClick={onSwitch} loading={switching}>
            Switch to Base Sepolia
          </Button>
        </Notice>
      )}
      {switchError && (
        <Notice tone="danger" size="sm" role="alert">
          {switchError}
        </Notice>
      )}
    </div>
  );
}
