import { Card } from '@/components/ui/Card';
import type { PaytagChain } from '@/lib/chains';
import { cx } from '@/lib/cx';
import { CHAIN_META, CHAIN_ORDER } from '@/lib/pay/meta';

interface Props {
  username: string;
  addresses: Partial<Record<PaytagChain, string>>;
  loading: boolean;
}

export function SetupCard({ username, addresses, loading }: Props) {
  const allSet = !loading && CHAIN_ORDER.every((c) => addresses[c]);
  const items = [
    { label: 'Claim your name', done: true, hint: `@${username}` },
    ...CHAIN_ORDER.map((c) => ({
      label: `Add ${CHAIN_META[c].label} address`,
      done: !!addresses[c],
      hint: loading || addresses[c] ? '' : 'below',
    })),
  ];

  return (
    <Card className="grid content-start gap-4">
      <div>
        <div className={cx('text-[13px] font-semibold', allSet ? 'text-ok' : 'text-warn')}>Setup</div>
        <h2 className="mt-1.5 font-display text-[26px] font-semibold tracking-display-md">
          {allSet ? 'You’re all set' : 'Finish setting up'}
        </h2>
      </div>
      {allSet && (
        <p className="text-[15px] leading-[1.55] text-ink2">
          Every chain is live. Share your link and payments land straight in your wallets.
        </p>
      )}
      <ul className="grid gap-2.5">
        {items.map((item) => (
          <li key={item.label} className="flex min-h-8 items-center gap-3">
            <span
              aria-hidden
              className={cx(
                'inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-ok',
                item.done ? 'bg-ok-bg' : 'border border-line2',
              )}
            >
              {item.done ? '✓' : ''}
            </span>
            <span className={cx('flex-1 text-[15px] font-semibold', item.done ? 'text-ink' : 'text-ink2')}>
              {item.label}
              <span className="sr-only">{item.done ? ' (done)' : ' (to do)'}</span>
            </span>
            {item.hint && <span className="font-mono text-[13px] text-ink3">{item.hint}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
