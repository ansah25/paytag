import { Router } from 'express';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { RateLimiter, rateLimit } from '../middleware/rateLimit';
import { env } from '../config/env';
import * as authController from '../controllers/authController';
import * as userController from '../controllers/userController';
import * as walletController from '../controllers/walletController';
import * as availabilityController from '../controllers/availabilityController';
import * as onchainController from '../controllers/onchainController';
import { syncedBlock } from '../services/onchainEventsService';
import { logger } from '../utils/logger';

export const router = Router();

// One budget shared by the public reads: each can cost an RPC call. The web app's server-rendered
// pages present API_SERVER_KEY instead of sharing Vercel's addresses' buckets.
const publicReads = rateLimit(new RateLimiter(env.PUBLIC_RATE_LIMIT_PER_MIN), {
  viaEdge: !!env.EDGE_SECRET,
  serverKey: env.API_SERVER_KEY,
});
// Sign-in and signup: unauthenticated, and they mint JWTs and usernames, so a tighter budget.
// A normal sign-in is two requests.
const authWrites = rateLimit(new RateLimiter(env.AUTH_RATE_LIMIT_PER_MIN), { viaEdge: !!env.EDGE_SECRET });

// Liveness for Fly's checks, which reach the machine directly: exempt from the edge guard.
router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Behind the edge guard: www.paytag.dev/status probes this, so a Cloudflare / EDGE_SECRET mismatch
// (every real request refused) shows as the API being down. It reads Postgres, so the probe also
// counts as database activity (a free Supabase project pauses after a week without any), and it
// reports how far the on-chain events table has synced.
router.get('/ping', async (_req, res) => {
  try {
    res.json({ status: 'ok', database: 'ok', onchainSyncedBlock: Number(await syncedBlock()) });
  } catch (err) {
    logger.warn('ping.database_failed', { reason: (err as Error).message });
    res.status(503).json({ status: 'degraded', database: 'unavailable', onchainSyncedBlock: null });
  }
});

router.get(
  '/auth/nonce',
  authWrites,
  validate(authController.nonceQuerySchema, 'query'),
  authController.getNonce,
);

router.post(
  '/auth/verify',
  authWrites,
  validate(authController.verifyBodySchema),
  authController.verify,
);

router.post('/auth/logout-all', authWrites, requireAuth, authController.logoutAll);

router.post(
  '/register',
  authWrites,
  requireAuth,
  validate(userController.registerBodySchema),
  userController.register,
);

router.get('/me', requireAuth, userController.me);

router.patch(
  '/me/profile',
  requireAuth,
  validate(userController.updateProfileBodySchema),
  userController.updateProfile,
);

router.post(
  '/add-address',
  requireAuth,
  validate(walletController.addAddressBodySchema),
  walletController.addAddress,
);

router.delete(
  '/address/:chain',
  requireAuth,
  validate(walletController.chainParamsSchema, 'params'),
  walletController.removeAddress,
);

router.post(
  '/verify-address/nonce',
  requireAuth,
  validate(walletController.verificationChallengeBodySchema),
  walletController.createVerificationChallenge,
);

router.post(
  '/verify-address',
  requireAuth,
  validate(walletController.verifyAddressBodySchema),
  walletController.verifyAddress,
);

router.get(
  '/resolve/:username',
  publicReads,
  validate(walletController.resolveParamsSchema, 'params'),
  walletController.resolve,
);

router.get(
  '/available/:username',
  publicReads,
  validate(availabilityController.availabilityParamsSchema, 'params'),
  validate(availabilityController.availabilityQuerySchema, 'query'),
  availabilityController.checkAvailability,
);

// On-chain names (the Base registry): lookups read the contracts directly; the two lists come from
// the lazily synced events table, re-checked against live state.
router.get(
  '/onchain/resolve/:name',
  publicReads,
  validate(onchainController.nameParamsSchema, 'params'),
  validate(onchainController.minBlockQuerySchema, 'query'),
  onchainController.resolve,
);

router.get(
  '/onchain/available/:name',
  publicReads,
  validate(onchainController.nameParamsSchema, 'params'),
  onchainController.available,
);

router.get(
  '/onchain/reverse/:address',
  publicReads,
  validate(onchainController.addressParamsSchema, 'params'),
  validate(onchainController.minBlockQuerySchema, 'query'),
  onchainController.reverse,
);

router.get(
  '/onchain/names',
  publicReads,
  validate(onchainController.namesQuerySchema, 'query'),
  onchainController.names,
);

router.get(
  '/onchain/pointing',
  publicReads,
  validate(onchainController.pointingQuerySchema, 'query'),
  onchainController.pointing,
);
