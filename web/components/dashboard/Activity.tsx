'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChainDot } from '@/components/ui/ChainDot';
import { StripedPlaceholder } from '@/components/ui/StripedPlaceholder';
import { useToast } from '@/components/ui/Toast';
import { api, type ActivityItem } from '@/lib/api';
import type { PaytagChain } from '@/lib/chains';
import { cx } from '@/lib/cx';
import { CHAIN_META } from '@/lib/pay/meta';

type Filter = 'all' | PaytagChain;

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ethereum', label: 'ETH' },
  { id: 'solana', label: 'SOL' },
  { id: 'bitcoin', label: 'BTC' },
];

const ROW_PADDING = 'px-[clamp(22px,3vw,32px)]';

/** Quote a CSV cell and neutralise spreadsheet formula prefixes. */
const csvCell = (value: string) => {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function Activity({
  username,
  onCountChange,
}: {
  username: string;
  onCountChange: (count: number) => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let cancelled = false;
    api
      .activity(username)
      .then((result) => {
        if (cancelled) return;
        setItems(result);
        onCountChange(result.length);
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [username, onCountChange]);

  const filtered = (items ?? []).filter((item) => filter === 'all' || item.chain === filter);

  const exportCsv = () => {
    const header = ['chain', 'from', 'amount', 'when', 'network', 'status'];
    const rows = filtered.map((i) => [i.chain, i.from, i.amount, i.when, i.network, i.status]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `paytag-${username}-activity.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('CSV exported');
  };

  return (
    <Card padding="none" as="section" aria-labelledby="activity-title" className="overflow-hidden">
      <div className={`flex flex-wrap items-end justify-between gap-3 pb-4 pt-6 ${ROW_PADDING}`}>
        <div>
          <div className="text-[13px] font-semibold text-accent">Activity</div>
          <h2 id="activity-title" className="mt-1.5 break-words font-display text-[26px] font-semibold tracking-display-md">
            Payments to @{username}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Filter by chain" className="flex gap-0.5 rounded-pill bg-surface2 p-[3px]">
            {FILTERS.map((f) => {
              const active = f.id === filter;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(f.id)}
                  // ::before extends the 34px pill to a 40px hit area.
                  className={cx(
                    "relative min-h-[34px] whitespace-nowrap rounded-pill px-3 text-xs font-bold transition-colors before:absolute before:inset-x-0 before:-inset-y-[3px] before:content-['']",
                    active ? 'bg-surface text-ink' : 'text-ink2 hover:text-ink',
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <Button variant="outline" size={40} disabled={filtered.length === 0} onClick={exportCsv}>
            Export CSV
          </Button>
        </div>
      </div>

      {filtered.length > 0 ? (
        filtered.map((item, index) => (
          <div
            key={`${item.chain}-${item.from}-${item.when}-${index}`}
            className={`grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line py-3.5 ${ROW_PADDING}`}
          >
            <span aria-hidden className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface2">
              <ChainDot chain={item.chain} size={10} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold">
                From <span className="font-mono font-medium">{item.from}</span>
              </div>
              <div className="mt-0.5 text-[13px] text-ink3">
                {item.when} · {item.network}
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[15px] font-medium text-ok">+{item.amount}</div>
              <div
                className={cx('mt-0.5 text-xs font-semibold', item.status === 'Confirmed' ? 'text-ink3' : 'text-warn')}
              >
                {item.status}
              </div>
            </div>
          </div>
        ))
      ) : (
        <div className={`flex flex-wrap items-center gap-5 border-t border-line pb-8 pt-7 ${ROW_PADDING}`}>
          <StripedPlaceholder className="h-[72px] w-[120px] shrink-0" />
          <p className="max-w-[420px] text-[15px] leading-[1.55] text-ink2">
            {items && items.length > 0 && filter !== 'all'
              ? `No ${CHAIN_META[filter].label} payments yet.`
              : 'Payment history is coming soon. Until then, incoming payments show up in your wallet and on a block explorer.'}
          </p>
        </div>
      )}
    </Card>
  );
}
