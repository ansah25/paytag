'use client';

import Link from 'next/link';
import { useEffect, useId, useReducer, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AddressText } from '@/components/ui/AddressText';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ChainDot } from '@/components/ui/ChainDot';
import { Notice } from '@/components/ui/Notice';
import { PulseDot } from '@/components/ui/Skeleton';
import type { PaytagChain } from '@/lib/chains';
import { cx } from '@/lib/cx';
import { formatUsd, shortAddress, splitAddress } from '@/lib/format';
import { walletErrorMessage } from '@/lib/pay/errors';
import { CHAIN_META } from '@/lib/pay/meta';
import type { FeeEstimate, PayAdapter, PayFlowProps } from '@/lib/pay/types';
import { useUsdPrice } from '@/lib/prices';
import { useCopy } from '@/lib/useCopy';

// Stages once a wallet is connected. connect / detecting / not_installed /
// wrong_chain / unsupported are derived from the adapter, not stored here.
type Stage = 'form' | 'review' | 'signing' | 'confirming' | 'unconfirmed' | 'success';

interface State {
  stage: Stage;
  amount: string;
  error: string | null;
  hash: string | null;
}

type Action =
  | { type: 'amount'; amount: string }
  | { type: 'invalid'; error: string }
  | { type: 'review' }
  | { type: 'edit' }
  | { type: 'signing' }
  | { type: 'signFailed'; error: string }
  | { type: 'sent'; hash: string; confirming: boolean }
  | { type: 'confirmed' }
  | { type: 'unconfirmed'; error: string }
  | { type: 'reset' };

const INITIAL: State = { stage: 'form', amount: '', error: null, hash: null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'amount':
      return { ...state, amount: action.amount, error: null };
    case 'invalid':
      return { ...state, error: action.error };
    case 'review':
      return { ...state, stage: 'review', error: null };
    case 'edit':
      return { ...state, stage: 'form', error: null };
    case 'signing':
      return { ...state, stage: 'signing', error: null };
    case 'signFailed':
      // Errors return to the stage they came from.
      return { ...state, stage: 'review', error: action.error };
    case 'sent':
      return { ...state, stage: action.confirming ? 'confirming' : 'success', hash: action.hash };
    case 'confirmed':
      return { ...state, stage: 'success' };
    case 'unconfirmed':
      return { ...state, stage: 'unconfirmed', error: action.error };
    case 'reset':
      return INITIAL;
  }
}

/** Digits and a single decimal point. */
const sanitizeAmount = (value: string) => value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');

const withArticle = (word: string) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;

type Fee = FeeEstimate | 'loading' | 'unavailable';

interface Props extends PayFlowProps {
  chain: PaytagChain;
  adapter: PayAdapter;
}

export function PayFlow({
  chain,
  adapter,
  username,
  recipient,
  verified,
  otherWallet,
  onSwitchChain,
  onBusyChange,
}: Props) {
  const meta = CHAIN_META[chain];
  const [{ stage, amount, error, hash }, dispatch] = useReducer(reducer, INITIAL);
  const [dismissedOther, setDismissedOther] = useState(false);
  const [fee, setFee] = useState<Fee>('loading');
  const { copied, copy } = useCopy();
  const amountId = useId();
  // Fiat on testnets would be misleading — hide it.
  const price = useUsdPrice(chain, !adapter.isTestnet);

  const busy = stage === 'signing' || stage === 'confirming';
  const inFlight = busy || stage === 'unconfirmed' || stage === 'success';
  const amountNumber = Number(amount);
  const hasAmount = amount !== '' && Number.isFinite(amountNumber) && amountNumber > 0;
  const toUsd = (native: number) => (price && native > 0 ? formatUsd(native * price) : null);
  const amountUsd = hasAmount ? toUsd(amountNumber) : null;
  const networkShort = adapter.networks.find((n) => n.id === adapter.network)?.label ?? '';

  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  // Wallet went away before signing: fall back so the connect stage shows.
  useEffect(() => {
    if (adapter.status !== 'connected' && stage === 'review') dispatch({ type: 'edit' });
  }, [adapter.status, stage]);

  // Estimate the fee on entering review. The ref avoids re-running when the
  // adapter object identity changes between renders.
  const estimateFee = useRef(adapter.estimateFee);
  estimateFee.current = adapter.estimateFee;
  useEffect(() => {
    if (stage !== 'review') return;
    let cancelled = false;
    setFee('loading');
    estimateFee
      .current(amount)
      .then((estimate) => !cancelled && setFee(estimate))
      .catch(() => !cancelled && setFee('unavailable'));
    return () => {
      cancelled = true;
    };
  }, [stage, amount]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const problem = adapter.validateAmount(amount);
    if (problem) dispatch({ type: 'invalid', error: problem });
    else dispatch({ type: 'review' });
  };

  const onConfirm = async () => {
    dispatch({ type: 'signing' });
    let sent: { hash: string };
    try {
      sent = await adapter.send(amount);
    } catch (err) {
      dispatch({
        type: 'signFailed',
        error: walletErrorMessage(err, {
          rejected: 'Transaction was rejected in the wallet.',
          fallback: 'The transaction couldn’t be sent.',
        }),
      });
      return;
    }
    const wait = adapter.waitForConfirmation;
    dispatch({ type: 'sent', hash: sent.hash, confirming: !!wait });
    if (!wait) return;
    try {
      await wait(sent.hash);
      dispatch({ type: 'confirmed' });
    } catch (err) {
      dispatch({
        type: 'unconfirmed',
        error: walletErrorMessage(err, { fallback: 'We couldn’t confirm the transaction.' }),
      });
    }
  };

  const feeLabel =
    fee === 'loading'
      ? 'Estimating…'
      : fee === 'unavailable'
        ? 'Unavailable'
        : [fee.display, toUsd(fee.native) && `(${toUsd(fee.native)})`, fee.detail && `· ${fee.detail}`]
            .filter(Boolean)
            .join(' ');

  const showOtherWallet =
    !inFlight &&
    !!otherWallet &&
    !dismissedOther &&
    (adapter.status === 'disconnected' || adapter.status === 'not_installed');
  const showNetworkToggle =
    !adapter.recipientError && (stage === 'form' || adapter.status !== 'connected') && !inFlight;

  let body: ReactNode;
  let live = '';

  if (adapter.recipientError) {
    body = (
      <Notice tone="danger" role="alert">
        {adapter.recipientError}
      </Notice>
    );
  } else if (stage === 'success') {
    live = `Sent ${amount} ${meta.symbol} to @${username}`;
    body = (
      <div className="grid animate-stage gap-[18px]">
        <div className="flex items-start gap-4 rounded-inset-xl bg-ok-bg p-[22px]">
          <span
            aria-hidden
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ok text-lg font-bold text-on-accent"
          >
            ✓
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-label text-ok">{meta.successKicker}</div>
            <div className="mt-1 break-words font-display text-[28px] font-semibold leading-[1.1] tracking-display-md">
              {amount} {meta.symbol} to @{username}
            </div>
            <div className="mt-1.5 text-sm leading-[1.5] text-ink2">
              {meta.successNote(adapter.networkLabel)}
              {amountUsd && ` · ≈ ${amountUsd}`}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {hash && (
            <Button variant="outline" href={adapter.explorerUrl(hash)}>
              {meta.explorerLabel} ↗
            </Button>
          )}
          <Button variant="ghost" onClick={() => dispatch({ type: 'reset' })}>
            Send another
          </Button>
        </div>
        <Link
          href="/#claim"
          className="flex items-center justify-between gap-3 rounded-inset border border-dashed border-line2 px-[18px] py-4 text-ink transition-colors hover:border-accent"
        >
          <span>
            <span className="block text-sm font-bold">Want your own @name?</span>
            <span className="mt-0.5 block text-[13px] text-ink2">
              Free, one signature, about thirty seconds.
            </span>
          </span>
          <span className="whitespace-nowrap text-sm font-bold text-accent">Claim →</span>
        </Link>
      </div>
    );
  } else if (stage === 'unconfirmed') {
    live = error ?? '';
    body = (
      <div className="grid animate-stage gap-4">
        <Notice tone="danger" role="alert">
          {error} The transaction was sent, so check the explorer before trying again.
        </Notice>
        <div className="flex flex-wrap gap-2">
          {hash && (
            <Button variant="outline" href={adapter.explorerUrl(hash)}>
              {meta.explorerLabel} ↗
            </Button>
          )}
          <Button variant="ghost" onClick={() => dispatch({ type: 'reset' })}>
            Send another
          </Button>
        </div>
      </div>
    );
  } else if (!busy && adapter.status === 'detecting') {
    body = (
      <div role="status" className="flex animate-stage items-center gap-2.5 text-[15px] text-ink2">
        <PulseDot />
        Detecting {meta.walletName}…
      </div>
    );
  } else if (showOtherWallet && otherWallet) {
    const otherLabel = CHAIN_META[otherWallet.chain].label;
    body = (
      <div className="grid animate-stage gap-3.5">
        <Notice tone="warn">
          Your connected wallet is {withArticle(otherLabel)} wallet, but you picked {meta.label}. Switch
          the chain above or connect {withArticle(meta.label)} wallet.
        </Notice>
        <div className="flex flex-wrap gap-2">
          <Button variant="solid" onClick={() => onSwitchChain(otherWallet.chain)}>
            Pay on {otherLabel} instead
          </Button>
          <Button variant="outline" onClick={() => setDismissedOther(true)}>
            Connect a different wallet
          </Button>
        </div>
      </div>
    );
  } else if (!busy && adapter.status === 'not_installed') {
    body = (
      <div className="grid animate-stage gap-3.5">
        <p className="text-[15px] leading-[1.55] text-ink2">
          {meta.walletName} isn’t installed in this browser. Install it, then come back to this page.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="solid" href="https://phantom.app/download">
            Get Phantom ↗
          </Button>
          {adapter.recheck && (
            <Button variant="outline" onClick={adapter.recheck}>
              Check again
            </Button>
          )}
        </div>
      </div>
    );
  } else if (!busy && adapter.status !== 'connected') {
    body = (
      <div className="grid animate-stage gap-4">
        <p className="text-[15px] leading-[1.55] text-ink2">{meta.connectCopy}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size={48}
            loading={adapter.status === 'connecting'}
            loadingLabel="Connecting…"
            onClick={() => void adapter.connect()}
          >
            Connect {meta.walletName}
          </Button>
          {adapter.connectError && (
            <span role="alert" className="text-sm font-medium text-danger">
              {adapter.connectError}
            </span>
          )}
        </div>
      </div>
    );
  } else if (!busy && adapter.unsupportedNetwork) {
    const [primaryNet, testNet] = adapter.networks;
    body = (
      <div className="grid animate-stage gap-3.5">
        {/* Only the EVM adapter reports unsupportedNetwork. */}
        <Notice tone="warn">
          Your wallet is on an unsupported network. Switch to Ethereum mainnet or Sepolia to continue.
        </Notice>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="solid"
            loading={adapter.switchingNetwork}
            loadingLabel="Switching…"
            onClick={() => adapter.setNetwork(primaryNet.id)}
          >
            Switch to mainnet
          </Button>
          {testNet && (
            <Button
              variant="outline"
              disabled={adapter.switchingNetwork}
              onClick={() => adapter.setNetwork(testNet.id)}
            >
              Use {testNet.label}
            </Button>
          )}
        </div>
        {adapter.networkError && (
          <span role="alert" className="text-sm font-medium text-danger">
            {adapter.networkError}
          </span>
        )}
      </div>
    );
  } else if (stage === 'form') {
    body = (
      <form onSubmit={onSubmit} noValidate className="grid min-w-0 animate-stage gap-[18px]">
        <div
          className={cx(
            'min-w-0 rounded-inset-xl border-[1.5px] bg-surface2 px-[22px] py-[18px] transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
            error ? 'border-danger' : hasAmount ? 'border-accent' : 'border-line',
          )}
        >
          <div className="flex justify-between gap-3">
            <label htmlFor={amountId} className="text-xs font-bold uppercase tracking-label text-ink3">
              Amount
            </label>
            {price !== null && (
              <span className="font-mono text-[13px] text-ink2">≈ {amountUsd ?? '$0.00'}</span>
            )}
          </div>
          <div className="mt-1.5 flex items-baseline gap-3">
            <input
              id={amountId}
              value={amount}
              onChange={(e) => dispatch({ type: 'amount', amount: sanitizeAmount(e.target.value) })}
              placeholder="0.00"
              inputMode="decimal"
              autoComplete="off"
              size={1}
              aria-invalid={!!error || undefined}
              className="w-0 min-w-0 flex-1 bg-transparent font-display text-[56px] font-semibold leading-none tracking-display-lg text-ink outline-none placeholder:text-ink3 focus-visible:outline-none"
            />
            <span className="font-mono text-lg font-medium text-ink2">{meta.symbol}</span>
          </div>
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            {meta.quickAmounts.map((quick) => (
              <button
                key={quick}
                type="button"
                onClick={() => dispatch({ type: 'amount', amount: quick })}
                aria-label={`${quick} ${meta.symbol}`}
                // ::before extends the 33px chip to a 40px hit area.
                className="relative whitespace-nowrap rounded-pill border border-line bg-surface px-3 py-[7px] font-mono text-xs text-ink2 transition-colors before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:border-accent hover:text-accent"
              >
                {quick}
              </button>
            ))}
          </div>
        </div>
        {adapter.isSelf && (
          <Notice tone="warn" size="sm">
            This is your own wallet — you’d be paying yourself.
          </Notice>
        )}
        {(error || adapter.networkError) && (
          <Notice tone="danger" size="sm" role="alert">
            {error ?? adapter.networkError}
          </Notice>
        )}
        <Button type="submit" size={56} fullWidth disabled={!hasAmount}>
          {hasAmount ? `Review ${amount} ${meta.symbol}` : 'Enter an amount'}
        </Button>
        <div className="flex flex-wrap justify-between gap-3 text-[13px] text-ink3">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
            Connected{adapter.walletVia ? ` via ${adapter.walletVia}` : ''} as{' '}
            {adapter.wallet ? shortAddress(adapter.wallet) : ''}
          </span>
          <span>You’ll review before signing</span>
        </div>
      </form>
    );
  } else {
    // review / signing / confirming
    const { head, tail } = splitAddress(recipient);
    live =
      stage === 'signing'
        ? `Confirm the transaction in your ${meta.walletName}`
        : stage === 'confirming'
          ? 'Transaction sent, awaiting confirmation'
          : 'Review before you sign';
    body = (
      <div className="grid animate-stage gap-4">
        <div className="text-xs font-bold uppercase tracking-label text-ink3">Review before you sign</div>
        <dl className="rounded-inset-xl bg-surface2 px-5 py-1.5">
          <ReviewRow term="To">
            <span className="text-sm font-bold">@{username}</span>
            <span className="mt-0.5 block font-mono text-xs text-ink2">
              <span className="font-bold text-ink">{head}</span>…<span className="font-bold text-ink">{tail}</span>
            </span>
          </ReviewRow>
          <ReviewRow term="Amount">
            <span className="font-display text-[22px] font-semibold tracking-display">
              {amount} {meta.symbol}
            </span>
            {amountUsd && <span className="mt-0.5 block font-mono text-xs text-ink2">≈ {amountUsd}</span>}
          </ReviewRow>
          <ReviewRow term="Network">
            <span className="text-sm font-semibold">
              {meta.label} · {networkShort}
            </span>
          </ReviewRow>
          <ReviewRow term="Estimated fee">
            <span className="font-mono text-[13px]">{feeLabel}</span>
          </ReviewRow>
          <ReviewRow term="From" last>
            <span className="font-mono text-[13px]">{adapter.wallet ? shortAddress(adapter.wallet) : '—'}</span>
          </ReviewRow>
        </dl>
        {error && (
          <Notice tone="danger" size="sm" role="alert">
            {error}
          </Notice>
        )}
        <Button
          size={56}
          fullWidth
          loading={busy}
          loadingLabel={stage === 'signing' ? `Confirm in ${meta.walletName}…` : 'Awaiting confirmation…'}
          onClick={() => void onConfirm()}
        >
          Confirm and sign
        </Button>
        {stage === 'confirming' && hash && (
          <a
            href={adapter.explorerUrl(hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-center font-mono text-xs text-ink3 transition-colors hover:text-ink"
          >
            Pending · {shortAddress(hash, 8, 6)} ↗
          </a>
        )}
        {stage === 'review' && (
          <Button variant="ghost" className="justify-self-center" onClick={() => dispatch({ type: 'edit' })}>
            ← Edit amount
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ChainDot chain={chain} size={10} />
          <h2 className="break-words font-display text-xl font-semibold tracking-display">
            Pay @{username} on {meta.label}
          </h2>
        </div>
        {showNetworkToggle && (
          <div
            role="group"
            aria-label={`${meta.label} network`}
            className="flex gap-0.5 rounded-pill bg-surface2 p-[3px]"
          >
            {adapter.networks.map((n) => {
              const active = n.id === adapter.network;
              return (
                <button
                  key={n.id}
                  type="button"
                  aria-pressed={active}
                  disabled={adapter.switchingNetwork}
                  onClick={() => !active && adapter.setNetwork(n.id)}
                  // ::before extends the hit area to 40px without changing the look.
                  className={cx(
                    "relative whitespace-nowrap rounded-pill px-3 py-[7px] text-xs font-semibold transition-colors before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] disabled:opacity-50",
                    active ? 'bg-surface text-ink' : 'text-ink2 hover:text-ink',
                  )}
                >
                  {n.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {stage !== 'success' && (
        <div className="flex min-w-0 items-center justify-between gap-3 rounded-inset-sm bg-surface2 px-3.5 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-label text-ink3">Recipient address</div>
            <AddressText address={recipient} className="mt-1 text-[13px]" />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {verified && <Badge>Verified</Badge>}
            <Button variant="outline-muted" size={36} onClick={() => void copy(recipient, 'Address copied')}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}

      <div key={stage} className="min-w-0">
        {body}
      </div>
      <p role="status" className="sr-only">
        {live}
      </p>
    </>
  );
}

function ReviewRow({ term, last = false, children }: { term: string; last?: boolean; children: ReactNode }) {
  return (
    <div className={cx('flex justify-between gap-3 py-3.5', !last && 'border-b border-line')}>
      <dt className="text-sm text-ink2">{term}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
