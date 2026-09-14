import { RequestHandler } from 'express';
import { z } from 'zod';
import * as walletService from '../services/walletService';
import * as verificationService from '../services/verificationService';
import { UnauthorizedError } from '../utils/errors';

export const addAddressBodySchema = z.object({
  chain: z.string().min(1),
  address: z.string().min(1),
});

export const resolveParamsSchema = z.object({
  username: z.string().min(1),
});

export const chainParamsSchema = z.object({
  chain: z.string().min(1),
});

export const verificationChallengeBodySchema = z.object({
  chain: z.string().min(1),
});

export const verifyAddressBodySchema = z.object({
  chain: z.string().min(1),
  // EVM hex signatures are 132 chars, ed25519 base64 is 88 — leave headroom.
  signature: z.string().min(1).max(512),
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

export const removeAddress: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new UnauthorizedError();
    }
    const { chain } = req.params as z.infer<typeof chainParamsSchema>;
    const result = await walletService.removeAddress(req.auth.sub, chain);
    res.json({ ...result, removed: true });
  } catch (err) {
    next(err);
  }
};

export const createVerificationChallenge: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new UnauthorizedError();
    }
    const { chain } = req.body as z.infer<typeof verificationChallengeBodySchema>;
    const challenge = await verificationService.createVerificationChallenge(req.auth.sub, chain);
    res.status(201).json(challenge);
  } catch (err) {
    next(err);
  }
};

export const verifyAddress: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth) {
      throw new UnauthorizedError();
    }
    const { chain, signature } = req.body as z.infer<typeof verifyAddressBodySchema>;
    const result = await verificationService.verifyAddress(req.auth.sub, chain, signature);
    res.json(result);
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
