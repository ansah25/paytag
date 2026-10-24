import { RequestHandler } from 'express';
import { z } from 'zod';
import * as onchainService from '../services/onchainService';

// The on-chain endpoints (formerly the Ponder indexer's). Same paths under /onchain and the same
// response shapes, so @paytagdev/sdk's resolveViaIndexer reads them unchanged.

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x-prefixed EVM address');

// A block the caller just wrote in: the answer must reflect at least that block.
const minBlock = z
  .string()
  .regex(/^\d{1,12}$/, 'minBlock must be a block number')
  .transform((v) => BigInt(v))
  .optional();

export const nameParamsSchema = z.object({ name: z.string().min(1).max(64) });
export const addressParamsSchema = z.object({ address });
export const minBlockQuerySchema = z.object({ minBlock });
export const namesQuerySchema = z.object({ owner: address, minBlock });
export const pointingQuerySchema = z.object({ account: address, minBlock });

// State can change every block; keep shared caches short. A caller that just wrote sends minBlock.
const CACHE_CONTROL = 'public, max-age=5, stale-while-revalidate=10';

const handler =
  (run: (req: Parameters<RequestHandler>[0]) => Promise<unknown>, cache = true): RequestHandler =>
  async (req, res, next) => {
    try {
      const body = await run(req);
      if (cache) res.set('Cache-Control', CACHE_CONTROL);
      res.json(body);
    } catch (err) {
      next(err);
    }
  };

// validate() has replaced params/query with the parsed values (minBlock is a bigint by then).
type MinBlock = { minBlock?: bigint };

export const resolve = handler((req) =>
  onchainService.resolveOnchain(req.params.name!, { minBlock: (req.query as MinBlock).minBlock }),
);

export const available = handler((req) => onchainService.availableOnchain(req.params.name!), false);

export const reverse = handler((req) =>
  onchainService.reverseOnchain(req.params.address!, { minBlock: (req.query as MinBlock).minBlock }),
);

export const names = handler((req) => {
  const { owner, minBlock: min } = req.query as unknown as z.infer<typeof namesQuerySchema>;
  return onchainService.namesByOwner(owner, { minBlock: min });
});

export const pointing = handler((req) => {
  const { account, minBlock: min } = req.query as unknown as z.infer<typeof pointingQuerySchema>;
  return onchainService.namesPointingAt(account, { minBlock: min });
});
