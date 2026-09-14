'use client';

import { useState } from 'react';
import { getDefaultProvider, getProviders } from 'sats-connect';
import { BITCOIN_NETWORKS, type BitcoinNetwork } from '@/lib/chains';
import { btcToSats, connectBitcoin, SATS_PER_BTC, sendBtc } from '@/lib/bitcoin';
import { walletErrorMessage } from './errors';
import { getSessionWallet, setSessionWallet } from './session';
import type { PayAdapter, PayNetwork } from './types';

const NETWORKS: PayNetwork[] = [
  { id: 'mainnet', label: 'Mainnet' },
  { id: 'testnet', label: 'Testnet' },
];

/** Size of a typical 1-input, 2-output native SegWit payment. */
const TYPICAL_VBYTES = 140;

/** "Xverse", "Leather"… when Sats Connect knows which wallet was picked. */
const walletBrand = (): string | null => {
  try {
    const id = getDefaultProvider();
    return id ? getProviders().find((p) => p.id === id)?.name ?? null : null;
  } catch {
    return null;
  }
};

export function useBitcoinPay(recipient: string): PayAdapter {
  // Sats Connect has no persistent "connected" state, so reuse the address
  // picked earlier in this tab (e.g. before switching chain tabs).
  const [address, setAddress] = useState<string | null>(() => getSessionWallet('bitcoin'));
  const [via, setVia] = useState<string | null>(() => (getSessionWallet('bitcoin') ? walletBrand() : null));
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [network, setNetworkState] = useState<BitcoinNetwork>('mainnet');
  const networkInfo = BITCOIN_NETWORKS[network];

  const connect = async () => {
    setConnectError(null);
    setConnecting(true);
    try {
      const { paymentAddress } = await connectBitcoin();
      setAddress(paymentAddress);
      setVia(walletBrand());
      setSessionWallet('bitcoin', paymentAddress);
    } catch (err) {
      setConnectError(
        walletErrorMessage(err, {
          rejected: 'Connection was rejected in the wallet.',
          fallback: 'Couldn’t connect to a Bitcoin wallet.',
        }),
      );
    } finally {
      setConnecting(false);
    }
  };

  return {
    status: address ? 'connected' : connecting ? 'connecting' : 'disconnected',
    connectError,
    connect,
    wallet: address,
    walletVia: via,

    networks: NETWORKS,
    network,
    // Only changes the explorer link — the wallet decides where it broadcasts.
    setNetwork: (id) => {
      if (id === 'mainnet' || id === 'testnet') setNetworkState(id);
    },
    switchingNetwork: false,
    networkError: null,
    unsupportedNetwork: false,
    networkLabel: networkInfo.label,
    isTestnet: network === 'testnet',

    // Format is validated server-side when the address is saved.
    recipientError: null,
    isSelf: !!address && address.toLowerCase() === recipient.toLowerCase(),

    validateAmount: (amount) => {
      try {
        btcToSats(amount);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : 'Enter a valid BTC amount.';
      }
    },

    estimateFee: async () => {
      const base = network === 'testnet' ? 'https://mempool.space/testnet' : 'https://mempool.space';
      const res = await fetch(`${base}/api/v1/fees/recommended`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { halfHourFee } = (await res.json()) as { halfHourFee?: unknown };
      if (typeof halfHourFee !== 'number' || halfHourFee <= 0) throw new Error('Unexpected fee payload');
      const sats = Math.ceil(halfHourFee * TYPICAL_VBYTES);
      return {
        native: sats / SATS_PER_BTC,
        display: `~${sats.toLocaleString('en-US')} sats`,
        detail: `${halfHourFee} sat/vB`,
      };
    },

    send: async (amount) => {
      const { txid } = await sendBtc({ toAddress: recipient, sats: btcToSats(amount), network });
      return { hash: txid };
    },

    explorerUrl: (hash) => networkInfo.explorerTxUrl(hash),
  };
}
