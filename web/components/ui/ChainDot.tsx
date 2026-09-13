import type { PaytagChain } from '@/lib/chains';
import { cx } from '@/lib/cx';

const COLORS: Record<PaytagChain, string> = {
  ethereum: 'bg-eth',
  solana: 'bg-sol',
  bitcoin: 'bg-btc',
};

/** Chain color dot. Decorative — always pair with a visible label or `title`. */
export function ChainDot({
  chain,
  size = 10,
  muted = false,
  title,
  className,
}: {
  chain: PaytagChain;
  size?: number;
  /** Chain not set: dot at 20% opacity. */
  muted?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden={title ? undefined : true}
      title={title}
      className={cx('inline-block shrink-0 rounded-full', COLORS[chain], muted && 'opacity-20', className)}
      style={{ width: size, height: size }}
    />
  );
}
