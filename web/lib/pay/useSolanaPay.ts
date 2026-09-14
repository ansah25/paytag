'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { SOLANA_NETWORKS, type SolanaNetwork } from '@/lib/chains';
import { confirmTransaction, connectPhantom, getPhantom, sendSol } from '@/lib/solana';
import { walletErrorMessage } from './errors';
import { setSessionWallet } from './session';
import type { PayAdapter, PayNetwork, WalletStatus } from './types';

const NETWORKS: PayNetwork[] = [
  { id: 'mainnet', label: 'Mainnet' },
  { id: 'devnet', label: 'Devnet' },
];

/** Base fee for a single-signature transfer. */
const FEE_LAMPORTS = 5000;
/** Phantom injects at document start, but give slow extensions one more look. */
const DETECT_RETRY_MS = 600;
const AMOUNT_PATTERN = /^(\d+(\.\d+)?|\.\d+)$/;

export function useSolanaPay(recipient: string): PayAdapter {
  const [status, setStatus] = useState<WalletStatus>('detecting');
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [network, setNetworkState] = useState<SolanaNetwork>('mainnet');
  const [connectError, setConnectError] = useState<string | null>(null);

  const applyDetection = useCallback((): boolean => {
    const phantom = getPhantom();
    if (!phantom) return false;
    if (phantom.isConnected && phantom.publicKey) {
      const key = phantom.publicKey.toString();
      setPubkey(key);
      setStatus('connected');
      setSessionWallet('solana', key);
    } else {
      setStatus('disconnected');
    }
    return true;
  }, []);

  const detect = useCallback(() => {
    setStatus('detecting');
    if (applyDetection()) return () => {};
    const id = setTimeout(() => {
      if (!applyDetection()) setStatus('not_installed');
    }, DETECT_RETRY_MS);
    return () => clearTimeout(id);
  }, [applyDetection]);

  useEffect(() => detect(), [detect]);

  // Follow account switches and disconnects made inside Phantom.
  const installed = status !== 'detecting' && status !== 'not_installed';
  useEffect(() => {
    const phantom = installed ? getPhantom() : null;
    if (!phantom) return;
    const onDisconnect = () => {
      setPubkey(null);
      setStatus('disconnected');
      setSessionWallet('solana', null);
    };
    const onAccountChanged = (next: unknown) => {
      if (!next) return onDisconnect();
      const key = String(next);
      setPubkey(key);
      setSessionWallet('solana', key);
    };
    phantom.on('disconnect', onDisconnect);
    phantom.on('accountChanged', onAccountChanged);
    return () => {
      phantom.removeListener?.('disconnect', onDisconnect);
      phantom.removeListener?.('accountChanged', onAccountChanged);
    };
  }, [installed]);

  const recipientError = useMemo(() => {
    try {
      new PublicKey(recipient);
      return null;
    } catch {
      return 'This Solana address isn’t valid, so it can’t receive a payment.';
    }
  }, [recipient]);

  const connect = async () => {
    setConnectError(null);
    setStatus('connecting');
    try {
      const key = await connectPhantom();
      setPubkey(key);
      setStatus('connected');
      setSessionWallet('solana', key);
    } catch (err) {
      setConnectError(
        walletErrorMessage(err, {
          rejected: 'Connection was rejected in Phantom.',
          fallback: 'Couldn’t connect to Phantom.',
        }),
      );
      setStatus(getPhantom() ? 'disconnected' : 'not_installed');
    }
  };

  const networkInfo = SOLANA_NETWORKS[network];

  return {
    status,
    connectError,
    connect,
    recheck: () => {
      detect();
    },
    wallet: status === 'connected' ? pubkey : null,
    walletVia: 'Phantom',

    networks: NETWORKS,
    network,
    setNetwork: (id) => {
      if (id === 'mainnet' || id === 'devnet') setNetworkState(id);
    },
    switchingNetwork: false,
    networkError: null,
    unsupportedNetwork: false,
    networkLabel: networkInfo.label,
    isTestnet: network === 'devnet',

    recipientError,
    isSelf: status === 'connected' && pubkey === recipient,

    validateAmount: (amount) => {
      if (!AMOUNT_PATTERN.test(amount.trim())) return 'Enter a valid SOL amount.';
      return Math.round(Number(amount) * LAMPORTS_PER_SOL) > 0
        ? null
        : 'Enter an amount greater than zero.';
    },

    estimateFee: async () => ({
      native: FEE_LAMPORTS / LAMPORTS_PER_SOL,
      display: '~0.000005 SOL',
    }),

    send: async (amount) => {
      if (!pubkey) throw new Error('Phantom is not connected.');
      const { signature } = await sendSol({
        fromPubkey: pubkey,
        toAddress: recipient,
        sol: Number(amount),
        network,
      });
      return { hash: signature };
    },

    waitForConfirmation: (hash) => confirmTransaction(hash, network),

    explorerUrl: (hash) => networkInfo.explorerTxUrl(hash),
  };
}
