'use client';

import { FormEvent, useState } from 'react';
import { BITCOIN_NETWORKS, BitcoinNetwork } from '@/lib/chains';
import {
  BitcoinSendError,
  btcToSats,
  connectBitcoin,
  sendBtc,
} from '@/lib/bitcoin';

interface Props {
  username: string;
  recipient: string;
}

const QUICK_AMOUNTS = ['0.0001', '0.001', '0.01', '0.1'];
const SHORT = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;

export function PayFormBitcoin({ username, recipient }: Props) {
  const [paymentAddress, setPaymentAddress] = useState<string | null>(null);
  const [walletType, setWalletType] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const [network, setNetwork] = useState<BitcoinNetwork>('mainnet');
  const [amount, setAmount] = useState('');
  const [signing, setSigning] = useState(false);
  const [txid, setTxid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const networkInfo = BITCOIN_NETWORKS[network];
  const sendingToSelf = paymentAddress?.toLowerCase() === recipient.toLowerCase();

  const onConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const { paymentAddress: addr, walletType: wt } = await connectBitcoin();
      setPaymentAddress(addr);
      setWalletType(wt);
    } catch (err) {
      setError(err instanceof BitcoinSendError ? err.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setTxid(null);

    let sats: number;
    try {
      sats = btcToSats(amount);
    } catch (err) {
      setError(err instanceof BitcoinSendError ? err.message : 'Invalid amount');
      return;
    }

    setSigning(true);
    try {
      const { txid: id } = await sendBtc({ toAddress: recipient, sats, network });
      setTxid(id);
    } catch (err) {
      setError(err instanceof BitcoinSendError ? err.message : 'Send failed');
    } finally {
      setSigning(false);
    }
  };

  // === Pre-connect ===
  if (!paymentAddress) {
    return (
      <div className="space-y-4">
        <p className="text-ink-2">
          Connect a Bitcoin wallet (Xverse, Leather/Hiro) to send BTC.
        </p>
        <button
          onClick={onConnect}
          disabled={connecting}
          className="btn-primary"
        >
          <span>{connecting ? 'Connecting…' : 'Connect Bitcoin wallet'}</span>
        </button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  // === Success ===
  if (txid) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl p-6 border border-success/30 bg-success/5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-success/15 flex items-center justify-center text-success font-bold">
              ✓
            </div>
            <div>
              <div className="eyebrow text-success">Broadcast</div>
              <div className="font-display font-bold text-2xl md:text-3xl text-ink mt-1 leading-tight">
                <span className="numeric">{amount}</span> BTC to{' '}
                <span className="text-primary">@{username}</span>
              </div>
              <div className="text-sm text-ink-3 mt-1">
                Sent on {networkInfo.label}. Bitcoin confirmations take ~10 min per block.
              </div>
            </div>
          </div>
        </div>
        <a
          href={networkInfo.explorerTxUrl(txid)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-bare"
        >
          <span>Track on mempool.space</span>
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
          {(Object.keys(BITCOIN_NETWORKS) as BitcoinNetwork[]).map((n) => (
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
              {BITCOIN_NETWORKS[n].label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-4">
          The actual broadcast network is whatever your wallet is set to —
          this just picks the explorer link.
        </p>
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
          <span className="font-mono text-base font-semibold text-ink-2 numeric">BTC</span>
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
          Connected{walletType ? ` via ${walletType}` : ''} as{' '}
          <span className="font-mono">{SHORT(paymentAddress)}</span>
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
        disabled={signing || !amount.trim()}
        className="btn-primary w-full justify-center !py-4 !text-base"
      >
        <span>
          {signing ? 'Confirm in wallet…' : amount ? `Send ${amount} BTC` : 'Send BTC'}
        </span>
      </button>

      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  );
}
