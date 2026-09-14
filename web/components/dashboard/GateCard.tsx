import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { shortAddress } from '@/lib/format';

type GateKind = 'connect' | 'sign' | 'no_name';

interface Props {
  kind: GateKind;
  wallet?: string;
  busy: 'connecting' | 'signing' | null;
  error: string | null;
  noWallet: boolean;
  onConnect: () => void;
  onSign: () => void;
  onDisconnect: () => void;
}

const COPY: Record<GateKind, { kicker: string; title: string; copy: string }> = {
  connect: {
    kicker: 'Welcome back',
    title: 'Connect a wallet',
    copy: 'Your wallet is your login. No password, no email — just the keys you already hold.',
  },
  sign: {
    kicker: 'One more step',
    title: 'Prove it’s you',
    copy: 'Sign a message to open your dashboard. No transaction, no gas.',
  },
  no_name: {
    kicker: 'Almost there',
    title: 'This wallet has no paytag yet',
    copy: 'Pick a name and it’s permanently linked to this wallet. Takes about thirty seconds.',
  },
};

/** Centered card for the signed-out states of /app. */
export function GateCard({ kind, wallet, busy, error, noWallet, onConnect, onSign, onDisconnect }: Props) {
  const text = COPY[kind];
  const signing = kind === 'sign' && busy === 'signing';
  const hasWallet = kind !== 'connect' && !!wallet;

  return (
    <section className="mx-auto flex w-full max-w-content justify-center px-6 pb-24 pt-[clamp(48px,10vh,120px)]">
      <div className="grid w-full max-w-[460px] animate-enter gap-[18px] rounded-panel border border-line bg-surface p-[clamp(24px,4vw,40px)]">
        <div
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-full bg-surface2 font-display text-[22px] font-bold text-accent"
        >
          @
        </div>
        <div>
          <div className="text-[13px] font-semibold text-accent">{text.kicker}</div>
          <h1 className="mt-2 font-display text-[32px] font-semibold leading-[1.05] tracking-display-md">
            {text.title}
          </h1>
          <p className="mt-2.5 text-[15px] leading-[1.55] text-ink2">
            {signing ? 'Check your wallet — a signature request is waiting.' : text.copy}
          </p>
        </div>

        {hasWallet && wallet && (
          <div className="flex items-center justify-between gap-3 rounded-inset-sm bg-surface2 px-4 py-3 font-mono text-[13px] text-ink2">
            <span title={wallet}>{shortAddress(wallet)}</span>
            <span className="inline-flex items-center gap-1.5 font-sans text-xs font-semibold text-ok">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
              Connected
            </span>
          </div>
        )}

        {kind === 'connect' && noWallet && (
          <Notice tone="warn">
            No browser wallet detected. Install MetaMask, Rabby or another injected wallet, then reload.
          </Notice>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          {kind === 'connect' && (
            <Button size={48} loading={busy === 'connecting'} loadingLabel="Connecting…" onClick={onConnect}>
              Connect wallet
            </Button>
          )}
          {kind === 'sign' && (
            <Button size={48} loading={signing} loadingLabel="Waiting for signature…" onClick={onSign}>
              Sign in with wallet
            </Button>
          )}
          {kind === 'no_name' && (
            <Button size={48} href="/claim">
              Choose a name
            </Button>
          )}
          {error && (
            <span role="alert" className="text-sm font-medium text-danger">
              {error}
            </span>
          )}
        </div>

        {hasWallet && (
          <button
            type="button"
            onClick={onDisconnect}
            className="inline-flex min-h-10 items-center justify-self-start text-[13px] font-semibold text-ink2 transition-colors hover:text-danger"
          >
            Disconnect wallet
          </button>
        )}
      </div>
    </section>
  );
}
