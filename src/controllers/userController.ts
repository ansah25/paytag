import { RequestHandler } from 'express';
import { z } from 'zod';
import * as userService from '../services/userService';
import * as profileService from '../services/profileService';
import { UnauthorizedError } from '../utils/errors';
import { MAX_LEN } from './limits';

export const registerBodySchema = z.object({
  username: z.string().min(1, 'username is required').max(MAX_LEN.username),
});

const CONTROL_CHARS = /\p{Cc}/gu;
// Characters that reorder or hide text, used to make a profile read as something it isn't: every
// default-ignorable code point (bidi marks/overrides/isolates, zero-width chars, BOM, soft hyphen,
// Hangul fillers, tag characters, ...) plus line/paragraph separators and the braille blank.
// Kept: U+200D (ZWJ) and the variation selectors U+FE00–FE0F, which emoji need. Known trade-off:
// subdivision flags (e.g. England) use tag characters and are rejected.
const DECEPTIVE_CHARS = /[\u2028\u2029\u2800]|(?![\u200D\uFE00-\uFE0F])\p{Default_Ignorable_Code_Point}/u;

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
    .refine((value) => value == null || !DECEPTIVE_CHARS.test(value), {
      message: `${label} contains invisible or text-direction characters`,
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
