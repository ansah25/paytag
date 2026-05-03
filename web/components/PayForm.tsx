'use client';

import { FormEvent, useState } from 'react';
import {
  useAccount,
  useChainId,
  useConnect,
  useSendTransaction,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { parseEther } from 'viem';
import { getChainInfo, isSupportedTxChain } from '@/lib/chains';

interface Props {
  username: string;
  recipient: `0x${string}`;
}

export function PayForm({ username, recipient }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectors, connect, isPending: connecting } = useConnect();
  const injected = connectors.find((c) => c.type === 'injected') ?? connectors[0];

  const {
    sendTransaction,
    data: hash,
    isPending: signing,
    error: sendError,
    reset,
  } = useSendTransaction();

  const {
    isLoading: confirming,
    isSuccess: confirmed,
  } = useWaitForTransactionReceipt({ hash });

  const [amount, setAmount] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  const chainInfo = getChainInfo(chainId);
  const sendingToSelf =
    isConnected && address?.toLowerCase() === recipient.toLowerCase();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setParseError(null);
    reset();
    let value: bigint;
    try {
      value = parseEther(amount);
      if (value <= 0n) throw new Error('Amount must be greater than zero');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid amount');
      return;
    }
    sendTransaction({ to: recipient, value });
  };

  if (!isConnected) {
    return (
      <div className="space-y-3">
        <p className="text-muted text-sm">Connect a wallet to send.</p>
        <button
          onClick={() => injected && connect({ connector: injected })}
          disabled={!injected || connecting}
          className="bg-accent hover:opacity-90 disabled:opacity-40 text-white font-medium px-6 py-3 rounded-lg"
        >
          {connecting ? 'Connecting…' : 'Connect wallet'}
        </button>
      </div>
    );
  }

  if (!isSupportedTxChain(chainId)) {
    return (
      <div className="p-4 rounded-lg bg-yellow-950/30 border border-yellow-800/50 text-yellow-200 text-sm">
        Switch your wallet to Ethereum mainnet or Sepolia to send.
      </div>
    );
  }

  if (confirmed && hash && chainInfo) {
    return (
      <div className="space-y-3">
        <div className="p-4 rounded-lg bg-emerald-950/30 border border-emerald-800/50 text-emerald-200 text-sm">
          Sent {amount} {chainInfo.nativeSymbol} to @{username} on {chainInfo.name}.
        </div>
        <a
          href={chainInfo.explorerTxUrl(hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent text-sm hover:underline break-all"
        >
          View transaction on {chainInfo.name} explorer →
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="text-sm text-muted">
        Network: <span className="text-white">{chainInfo?.name}</span>
      </div>

      <div className="space-y-2">
        <label className="text-sm text-muted block">Amount ({chainInfo?.nativeSymbol})</label>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.01"
          inputMode="decimal"
          className="w-full bg-panel border border-border rounded-lg px-4 py-3 outline-none focus:border-accent"
        />
      </div>

      {sendingToSelf && (
        <div className="text-xs text-yellow-300">
          Heads up: this is your own wallet.
        </div>
      )}

      <button
        type="submit"
        disabled={signing || confirming || !amount.trim()}
        className="bg-accent hover:opacity-90 disabled:opacity-40 text-white font-medium px-6 py-3 rounded-lg"
      >
        {signing
          ? 'Confirm in wallet…'
          : confirming
            ? 'Waiting for confirmation…'
            : `Send ${chainInfo?.nativeSymbol ?? ''}`}
      </button>

      {hash && !confirmed && chainInfo && (
        <a
          href={chainInfo.explorerTxUrl(hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs text-muted hover:text-white break-all"
        >
          Pending: {hash}
        </a>
      )}

      {parseError && <p className="text-sm text-red-300">{parseError}</p>}
      {sendError && (
        <p className="text-sm text-red-300">
          {/* user-rejected and other wallet errors arrive with shortMessage on viem errors */}
          {(sendError as { shortMessage?: string }).shortMessage ?? sendError.message}
        </p>
      )}
    </form>
  );
}
