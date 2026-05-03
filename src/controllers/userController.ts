import { RequestHandler } from 'express';
import { z } from 'zod';
import * as userService from '../services/userService';
import { UnauthorizedError } from '../utils/errors';

export const registerBodySchema = z.object({
  username: z.string().min(1, 'username is required'),
});

export const register: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new UnauthorizedError();
    }
    const { username } = req.body as z.infer<typeof registerBodySchema>;
    const user = await userService.registerUsername(username, req.auth.sub);
    res.status(201).json({
      id: user.id,
      username: user.username,
      ownerWallet: user.owner_wallet,
      createdAt: user.created_at,
    });
  } catch (err) {
    next(err);
  }
};
