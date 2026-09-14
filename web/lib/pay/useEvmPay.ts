'use client';

import { useState } from 'react';
import { formatEther, isAddress, parseEther, type Address, type Hash } from 'viem';
import { useAccount, useConnect, usePublicClient, useSendTransaction, useSwitchChain } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';
import { getChainInfo } from '@/lib/chains';
import { formatTokenAmount } from '@/lib/format';
import { walletErrorMessage } from './errors';
import type { PayAdapter, PayNetwork } from './types';

type SupportedChainId = typeof mainnet.id | typeof sepolia.id;

const NETWORKS: PayNetwork[] = [
  { id: String(mainnet.id), label: 'Mainnet' },
  { id: String(sepolia.id), label: 'Sepolia' },
];

const NETWORK_LABEL: Record<SupportedChainId, string> = {
  [mainnet.id]: 'Ethereum mainnet',
  [sepolia.id]: 'Sepolia',
};

const NO_WALLET = 'No browser wallet detected. Install MetaMask or another browser wallet.';

const isSupported = (id: number | undefined): id is SupportedChainId =>
  id === mainnet.id || id === sepolia.id;

export function useEvmPay(recipient: string): PayAdapter {
  const { address, status, chainId: walletChainId } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { switchChainAsync, isPending: switchingNetwork } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();

  // Before a wallet is connected the toggle records a preference, which is
  // requested at connect time. Afterwards the wallet's own chain is the truth.
  const [preferredChainId, setPreferredChainId] = useState<SupportedChainId>(mainnet.id);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);

  const wallet = status === 'connected' && address ? address : null;
  const unsupportedNetwork = !!wallet && !isSupported(walletChainId);
  const chainId: SupportedChainId =
    wallet && isSupported(walletChainId) ? walletChainId : preferredChainId;
  const publicClient = usePublicClient({ chainId });
  const to = recipient as Address;

  const connect = async () => {
    setConnectError(null);
    const injected = connectors.find((c) => c.type === 'injected') ?? connectors[0];
    if (!injected) {
      setConnectError(NO_WALLET);
      return;
    }
    setConnecting(true);
    try {
      await connectAsync({ connector: injected, chainId: preferredChainId });
    } catch (err) {
      setConnectError(
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

  const setNetwork = (id: string) => {
    const next = Number(id);
    if (!isSupported(next)) return;
    setNetworkError(null);
    setPreferredChainId(next);
    if (!wallet || walletChainId === next) return;
    switchChainAsync({ chainId: next }).catch((err) =>
      setNetworkError(
        walletErrorMessage(err, {
          rejected: 'Network switch was rejected in the wallet.',
          fallback: 'Couldn’t switch networks — change it in your wallet.',
        }),
      ),
    );
  };

  return {
    status: wallet
      ? 'connected'
      : connecting || status === 'connecting' || status === 'reconnecting'
        ? 'connecting'
        : 'disconnected',
    connectError,
    connect,
    wallet,
    walletVia: null,

    networks: NETWORKS,
    network: String(chainId),
    setNetwork,
    switchingNetwork,
    networkError,
    unsupportedNetwork,
    networkLabel: NETWORK_LABEL[chainId],
    isTestnet: chainId === sepolia.id,

    recipientError: isAddress(recipient)
      ? null
      : 'This Ethereum address isn’t valid, so it can’t receive a payment.',
    isSelf: !!wallet && wallet.toLowerCase() === recipient.toLowerCase(),

    validateAmount: (amount) => {
      try {
        return parseEther(amount) > 0n ? null : 'Enter an amount greater than zero.';
      } catch {
        return 'Enter a valid ETH amount.';
      }
    },

    estimateFee: async (amount) => {
      if (!publicClient || !wallet) throw new Error('Wallet not connected');
      const [gas, gasPrice] = await Promise.all([
        publicClient.estimateGas({ account: wallet, to, value: parseEther(amount) }),
        publicClient.getGasPrice(),
      ]);
      const native = Number(formatEther(gas * gasPrice));
      return { native, display: `~${formatTokenAmount(native)} ETH` };
    },

    send: async (amount) => {
      const hash = await sendTransactionAsync({ to, value: parseEther(amount), chainId });
      return { hash };
    },

    waitForConfirmation: async (hash) => {
      if (!publicClient) throw new Error('No RPC connection for this network.');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: hash as Hash });
      if (receipt.status === 'reverted') throw new Error('The transaction was reverted on-chain.');
    },

    explorerUrl: (hash) => getChainInfo(chainId)?.explorerTxUrl(hash) ?? '#',
  };
}
