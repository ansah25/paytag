import { RequestHandler } from 'express';
import { z } from 'zod';
import * as walletService from '../services/walletService';
import { UnauthorizedError } from '../utils/errors';

export const addAddressBodySchema = z.object({
  chain: z.string().min(1),
  address: z.string().min(1),
});

export const resolveParamsSchema = z.object({
  username: z.string().min(1),
});

export const addAddress: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new UnauthorizedError();
    }
    const { chain, address } = req.body as z.infer<typeof addAddressBodySchema>;
    const entry = await walletService.addAddress(req.auth.sub, chain, address);
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
};

export const resolve: RequestHandler = async (req, res, next) => {
  try {
    const { username } = req.params as z.infer<typeof resolveParamsSchema>;
    const result = await walletService.resolveByUsername(username);
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    res.json(result);
  } catch (err) {
    next(err);
  }
};
