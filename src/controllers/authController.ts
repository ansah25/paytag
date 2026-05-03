import { RequestHandler } from 'express';
import { z } from 'zod';
import * as authService from '../services/authService';

export const nonceQuerySchema = z.object({
  wallet: z.string().min(1, 'wallet is required'),
});

export const verifyBodySchema = z.object({
  wallet: z.string().min(1),
  signature: z.string().min(1),
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
    const { wallet, signature } = req.body as z.infer<typeof verifyBodySchema>;
    const { token, wallet: normalized } = await authService.verifySignatureAndIssueToken(
      wallet,
      signature,
    );
    res.json({ token, wallet: normalized });
  } catch (err) {
    next(err);
  }
};
