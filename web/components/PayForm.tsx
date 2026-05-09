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
import { NetworkSelector } from './NetworkSelector';

interface Props {
  username: string;
  recipient: `0x${string}`;
}

const QUICK_AMOUNTS = ['0.005', '0.01', '0.05', '0.1'];

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

  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({
    hash,
  });

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
      <div className="space-y-4">
        <p className="text-ink-2">Connect a wallet to send.</p>
        <button
          onClick={() => injected && connect({ connector: injected })}
          disabled={!injected || connecting}
          className="btn-primary"
        >
          <span>{connecting ? 'Connecting…' : 'Connect wallet'}</span>
        </button>
      </div>
    );
  }

  if (!isSupportedTxChain(chainId)) {
    return (
      <div className="space-y-5">
        <div className="bg-amber/10 border border-amber/40 text-amber-900 rounded-xl p-4 text-sm">
          <span className="font-semibold">Switch network.</span> Pick a supported network
          to send on.
        </div>
        <NetworkSelector />
      </div>
    );
  }

  if (confirmed && hash && chainInfo) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl p-6 border border-success/30 bg-success/5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-success/15 flex items-center justify-center text-success font-bold">
              ✓
            </div>
            <div>
              <div className="eyebrow text-success">Sent</div>
              <div className="font-display font-bold text-2xl md:text-3xl text-ink mt-1 leading-tight">
                <span className="numeric">{amount}</span> {chainInfo.nativeSymbol} to{' '}
                <span className="text-primary">@{username}</span>
              </div>
              <div className="text-sm text-ink-3 mt-1">
                Confirmed on {chainInfo.name}
              </div>
            </div>
          </div>
        </div>
        <a
          href={chainInfo.explorerTxUrl(hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-bare"
        >
          <span>View transaction</span>
          <span aria-hidden>↗</span>
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-7">
      <NetworkSelector />

      <div>
        <div className="eyebrow-muted mb-3">Amount</div>
        <div className="flex items-baseline gap-3 border border-hairline focus-within:border-primary focus-within:shadow-[0_0_0_4px_rgba(84,105,212,0.15)] rounded-2xl px-5 py-4 bg-white transition-all">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            className="flex-1 bg-transparent border-0 outline-none font-display font-bold text-[44px] md:text-[56px] leading-none text-ink placeholder:text-ink-4/40 numeric min-w-0"
          />
          <span className="font-mono text-base font-semibold text-ink-2 numeric">
            {chainInfo?.nativeSymbol}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-3">
          {QUICK_AMOUNTS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setAmount(q)}
              className="font-mono text-xs font-semibold text-ink-2 bg-paper border border-hairline hover:border-primary hover:text-primary rounded-full px-3 py-1.5 numeric transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {sendingToSelf && (
        <div className="text-xs text-amber italic flex items-center gap-1.5">
          <span>⚠</span>
          <span>This is your own wallet.</span>
        </div>
      )}

      <button
        type="submit"
        disabled={signing || confirming || !amount.trim()}
        className="btn-primary w-full justify-center !py-4 !text-base"
      >
        <span>
          {signing
            ? 'Confirm in wallet…'
            : confirming
              ? 'Awaiting confirmation…'
              : amount
                ? `Send ${amount} ${chainInfo?.nativeSymbol ?? ''}`
                : `Send ${chainInfo?.nativeSymbol ?? ''}`}
        </span>
      </button>

      {hash && !confirmed && chainInfo && (
        <a
          href={chainInfo.explorerTxUrl(hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs text-ink-3 hover:text-primary font-mono break-all"
        >
          Pending · {hash}
        </a>
      )}

      {parseError && <p className="text-sm text-danger">{parseError}</p>}
      {sendError && (
        <p className="text-sm text-danger">
          {(sendError as { shortMessage?: string }).shortMessage ?? sendError.message}
        </p>
      )}
    </form>
  );
}
