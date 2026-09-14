'use client';

import { useEffect, useState } from 'react';
import type { PaytagChain } from './chains';

export type UsdPrices = Record<PaytagChain, number>;

const PRICE_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,solana,bitcoin&vs_currencies=usd';
const TTL_MS = 60_000;
/** On a failed refresh, a slightly old price beats hiding the fiat line. */
const STALE_MS = 10 * 60_000;

let cached: { at: number; prices: UsdPrices } | null = null;
let inflight: Promise<UsdPrices | null> | null = null;

const freshCached = (maxAge: number): UsdPrices | null =>
  cached && Date.now() - cached.at < maxAge ? cached.prices : null;

/** ETH/SOL/BTC in USD. Shared 60s cache; resolves null when unavailable. */
export function getUsdPrices(): Promise<UsdPrices | null> {
  const fresh = freshCached(TTL_MS);
  if (fresh) return Promise.resolve(fresh);
  if (inflight) return inflight;

  inflight = fetch(PRICE_URL, { signal: AbortSignal.timeout(5000) })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((body: Partial<Record<PaytagChain, { usd?: unknown }>>) => {
      const prices = {
        ethereum: body.ethereum?.usd,
        solana: body.solana?.usd,
        bitcoin: body.bitcoin?.usd,
      };
      if (!Object.values(prices).every((v) => typeof v === 'number' && v > 0)) {
        throw new Error('Unexpected price payload');
      }
      cached = { at: Date.now(), prices: prices as UsdPrices };
      return cached.prices;
    })
    .catch(() => freshCached(STALE_MS))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** USD price for one chain, refreshed every minute. Null hides the fiat line. */
export function useUsdPrice(chain: PaytagChain, enabled = true): number | null {
  const [price, setPrice] = useState<number | null>(() =>
    enabled ? freshCached(TTL_MS)?.[chain] ?? null : null,
  );

  useEffect(() => {
    if (!enabled) {
      setPrice(null);
      return;
    }
    let cancelled = false;
    const load = () =>
      getUsdPrices().then((prices) => {
        if (!cancelled) setPrice(prices?.[chain] ?? null);
      });
    load();
    const id = setInterval(load, TTL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [chain, enabled]);

  return price;
}
