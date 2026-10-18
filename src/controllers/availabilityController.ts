import { RequestHandler } from 'express';
import { z } from 'zod';
import { MAX_LEN } from './limits';
import { checkAvailability as checkUsernameAvailability } from '../services/userService';

export const availabilityParamsSchema = z.object({
  username: z.string().min(1).max(MAX_LEN.username),
});

// `wallet` is the caller's connected wallet: a name it already owns on-chain isn't reported
// as taken there.
export const availabilityQuerySchema = z.object({
  wallet: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'wallet must be a 0x-prefixed EVM address')
    .optional(),
});

export const checkAvailability: RequestHandler = async (req, res, next) => {
  try {
    const { username } = req.params as z.infer<typeof availabilityParamsSchema>;
    const { wallet } = req.query as z.infer<typeof availabilityQuerySchema>;
    res.json(await checkUsernameAvailability(username, wallet));
  } catch (err) {
    next(err);
  }
};
