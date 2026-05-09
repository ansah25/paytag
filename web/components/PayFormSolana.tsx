'use client';

import { FormEvent, useEffect, useState } from 'react';
import { SOLANA_NETWORKS, SolanaNetwork } from '@/lib/chains';
import {
  confirmTransaction,
  connectPhantom,
  getPhantom,
  sendSol,
  SolanaSendError,
} from '@/lib/solana';

interface Props {
  username: string;
  recipient: string;
}

const QUICK_AMOUNTS = ['0.05', '0.1', '0.5', '1'];
const SHORT = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

export function PayFormSolana({ username, recipient }: Props) {
  const [phantomDetected, setPhantomDetected] = useState<boolean | null>(null);
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const [network, setNetwork] = useState<SolanaNetwork>('mainnet');
  const [amount, setAmount] = useState('');
  const [signing, setSigning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const phantom = getPhantom();
    setPhantomDetected(!!phantom);
    if (phantom?.isConnected && phantom.publicKey) {
      setPubkey(phantom.publicKey.toString());
    }
  }, []);

  const sendingToSelf = pubkey?.toLowerCase() === recipient.toLowerCase();
  const networkInfo = SOLANA_NETWORKS[network];

  const onConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const key = await connectPhantom();
      setPubkey(key);
    } catch (err) {
      setError(err instanceof SolanaSendError ? err.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSignature(null);
    setConfirmed(false);

    const sol = Number(amount);
    if (!Number.isFinite(sol) || sol <= 0) {
      setError('Enter a positive amount.');
      return;
    }
    if (!pubkey) return;

    setSigning(true);
    let sig: string;
    try {
      const result = await sendSol({
        fromPubkey: pubkey,
        toAddress: recipient,
        sol,
        network,
      });
      sig = result.signature;
      setSignature(sig);
    } catch (err) {
      setError(err instanceof SolanaSendError ? err.message : 'Send failed');
      setSigning(false);
      return;
    }
    setSigning(false);

    setConfirming(true);
    try {
      await confirmTransaction(sig, network);
      setConfirmed(true);
    } catch (err) {
      setError(err instanceof SolanaSendError ? err.message : 'Confirmation failed');
    } finally {
      setConfirming(false);
    }
  };

  // === Pre-connect ===
  if (phantomDetected === null) {
    return <div className="text-sm text-ink-3 py-4">Detecting wallet…</div>;
  }

  if (!phantomDetected) {
    return (
      <div className="space-y-4">
        <div className="bg-amber/10 border border-amber/40 rounded-xl p-4 text-sm text-ink-2">
          <span className="font-semibold text-ink">Phantom not detected.</span> Install
          it to send SOL.
        </div>
        <a
          href="https://phantom.app/download"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary"
        >
          <span>Install Phantom</span>
          <span aria-hidden>↗</span>
        </a>
      </div>
    );
  }

  if (!pubkey) {
    return (
      <div className="space-y-4">
        <p className="text-ink-2">Connect Phantom to send SOL.</p>
        <button
          onClick={onConnect}
          disabled={connecting}
          className="btn-primary"
        >
          <span>{connecting ? 'Connecting…' : 'Connect Phantom'}</span>
        </button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  // === Success ===
  if (confirmed && signature) {
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
                <span className="numeric">{amount}</span> SOL to{' '}
                <span className="text-primary">@{username}</span>
              </div>
              <div className="text-sm text-ink-3 mt-1">
                Confirmed on {networkInfo.label}
              </div>
            </div>
          </div>
        </div>
        <a
          href={networkInfo.explorerTxUrl(signature)}
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

  // === Form ===
  return (
    <form onSubmit={onSubmit} className="space-y-7">
      <div>
        <div className="eyebrow-muted mb-3">Network</div>
        <div className="flex gap-2">
          {(Object.keys(SOLANA_NETWORKS) as SolanaNetwork[]).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNetwork(n)}
              className={`flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl border transition-colors ${
                network === n
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-hairline bg-white text-ink-2 hover:border-primary/40'
              }`}
            >
              {SOLANA_NETWORKS[n].label}
            </button>
          ))}
        </div>
      </div>

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
          <span className="font-mono text-base font-semibold text-ink-2 numeric">SOL</span>
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

      <div className="text-xs text-ink-3 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-success" />
        <span>
          Connected as <span className="font-mono">{SHORT(pubkey)}</span>
        </span>
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
            ? 'Confirm in Phantom…'
            : confirming
              ? 'Awaiting confirmation…'
              : amount
                ? `Send ${amount} SOL`
                : 'Send SOL'}
        </span>
      </button>

      {signature && !confirmed && (
        <a
          href={networkInfo.explorerTxUrl(signature)}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs text-ink-3 hover:text-primary font-mono break-all"
        >
          Pending · {signature}
        </a>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  );
}
