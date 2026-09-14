const TILES = [
  { symbol: 'ETH', address: '0x4f3e…c2' },
  { symbol: 'SOL', address: '4Nd1…Pq' },
  { symbol: 'BTC', address: 'bc1q…t4' },
];

/**
 * Decorative paytag card for the landing hero — CSS only. The float is a
 * transform animation (compositor-only) and stops under reduced motion.
 */
export function IdentityCard({ name }: { name: string }) {
  return (
    <div aria-hidden className="relative h-[300px] w-full max-w-[720px]">
      <div className="absolute inset-x-0 top-10 mx-auto h-[260px] w-[min(460px,90%)] translate-x-10 rotate-[4deg] rounded-card border border-line bg-surface2 max-[480px]:translate-x-4" />
      <div className="absolute inset-x-0 top-5 mx-auto flex h-[260px] w-[min(460px,90%)] animate-float flex-col justify-between rounded-card border border-line2 bg-surface p-7 shadow-float max-[480px]:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent font-display text-lg font-bold text-on-accent">
              {name.charAt(0)}
            </span>
            <div className="min-w-0 text-left">
              <div className="truncate font-display text-[22px] font-semibold tracking-display">@{name}</div>
              <div className="truncate font-mono text-xs text-ink2">paytag.dev/{name}</div>
            </div>
          </div>
          <span className="shrink-0 rounded-pill border border-line2 px-2.5 py-1 text-[11px] font-bold uppercase tracking-kicker text-accent">
            Verified
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {TILES.map((tile) => (
            <div key={tile.symbol} className="min-w-0 rounded-inset-sm bg-surface2 p-3 text-left">
              <div className="text-[11px] font-bold tracking-label text-ink2">{tile.symbol}</div>
              <div className="mt-1.5 truncate font-mono text-xs">{tile.address}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
