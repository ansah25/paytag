import { RequestHandler } from 'express';
import { z } from 'zod';
import * as authService from '../services/authService';
import { MAX_LEN, bounded } from './limits';

export const nonceQuerySchema = z.object({
  wallet: z.string().min(1, 'wallet is required').max(MAX_LEN.wallet),
});

export const verifyBodySchema = z.object({
  wallet: bounded(MAX_LEN.wallet),
  signature: bounded(MAX_LEN.authSignature),
  // The nonce this signature is over. Optional in the schema only so that an outdated client gets
  // a clear CLIENT_OUTDATED from the service instead of a generic validation error.
  nonce: z.string().regex(/^[0-9a-f]{80}$/).optional(),
});

export const getNonce: RequestHandler = async (req, res, next) => {
  try {
    const { wallet } = req.query as z.infer<typeof nonceQuerySchema>;
    const nonce = await authService.createNonce(wallet);
    res.json({ nonce });
  } catch (err) {
    next(err);
  }
};

export const verify: RequestHandler = async (req, res, next) => {
  try {
    const { wallet, signature, nonce } = req.body as z.infer<typeof verifyBodySchema>;
    const { token, wallet: normalized } = await authService.verifySignatureAndIssueToken(
      wallet,
      signature,
      nonce,
    );
    res.json({ token, wallet: normalized });
  } catch (err) {
    next(err);
  }
};
