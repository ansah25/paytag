import { RequestHandler } from 'express';
import { z } from 'zod';
import * as userService from '../services/userService';
import * as profileService from '../services/profileService';
import { UnauthorizedError } from '../utils/errors';

export const registerBodySchema = z.object({
  username: z.string().min(1, 'username is required'),
});

const CONTROL_CHARS = /\p{Cc}/gu;

/**
 * Optional profile text: control characters become spaces, surrounding
 * whitespace is trimmed, and an empty result clears the field (null).
 */
const profileText = (max: number, label: string) =>
  z
    .string()
    .nullable()
    .optional()
    .transform((value) => (typeof value === 'string' ? value.replace(CONTROL_CHARS, ' ').trim() : value))
    .refine((value) => value == null || value.length <= max, {
      message: `${label} must be ${max} characters or fewer`,
    })
    .transform((value) => (value === '' ? null : value));

export const updateProfileBodySchema = z
  .object({
    displayName: profileText(profileService.PROFILE_LIMITS.displayName, 'Display name'),
    bio: profileText(profileService.PROFILE_LIMITS.bio, 'Bio'),
  })
  .refine((body) => body.displayName !== undefined || body.bio !== undefined, {
    message: 'Provide displayName or bio',
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

export const me: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new UnauthorizedError();
    }
    const wallet = req.auth.sub;
    const user = await userService.findByWallet(wallet);
    res.json({
      wallet,
      username: user?.username ?? null,
      createdAt: user?.created_at ?? null,
      displayName: user?.display_name ?? null,
      bio: user?.bio ?? null,
      avatarUrl: user?.avatar_url ?? null,
    });
  } catch (err) {
    next(err);
  }
};

export const updateProfile: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new UnauthorizedError();
    }
    const patch = req.body as z.infer<typeof updateProfileBodySchema>;
    const user = await profileService.updateProfile(req.auth.sub, patch);
    res.json({
      username: user.username,
      displayName: user.display_name ?? null,
      bio: user.bio ?? null,
      avatarUrl: user.avatar_url ?? null,
    });
  } catch (err) {
    next(err);
  }
};
