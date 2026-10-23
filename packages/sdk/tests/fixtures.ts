import type { FetchLike } from '../src';

// Real, valid mainnet addresses: the SDK checks every address it returns.
export const ETH = '0x6ad631f215393f9635231de985081b1ccddc7c11';
export const SOL = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T';
export const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

export const mockResponse = (
  ok: boolean,
  status: number,
  body: unknown,
): Awaited<ReturnType<FetchLike>> => ({
  ok,
  status,
  json: async () => body,
});
