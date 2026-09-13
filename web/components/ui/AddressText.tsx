import { cx } from '@/lib/cx';
import { splitAddress } from '@/lib/format';

/**
 * Mono address with the first 6 and last 4 characters emphasized. Only the
 * middle truncates, so the tail stays visible at any width.
 */
export function AddressText({ address, className }: { address: string; className?: string }) {
  const { head, mid, tail } = splitAddress(address);
  return (
    <span title={address} className={cx('flex min-w-0 whitespace-nowrap font-mono', className)}>
      <span className="font-bold text-ink">{head}</span>
      <span className="min-w-0 truncate text-ink3">{mid}</span>
      <span className="font-bold text-ink">{tail}</span>
    </span>
  );
}
