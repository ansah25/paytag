import { Router } from 'express';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { RateLimiter, rateLimit } from '../middleware/rateLimit';
import { env } from '../config/env';
import * as authController from '../controllers/authController';
import * as userController from '../controllers/userController';
import * as walletController from '../controllers/walletController';
import * as availabilityController from '../controllers/availabilityController';

export const router = Router();

// One budget shared by the public reads: each can trigger an indexer lookup.
const publicReads = rateLimit(new RateLimiter(env.PUBLIC_RATE_LIMIT_PER_MIN), { viaEdge: !!env.EDGE_SECRET });
// Sign-in and signup: unauthenticated, and they mint JWTs and usernames, so a tighter budget.
// A normal sign-in is two requests.
const authWrites = rateLimit(new RateLimiter(env.AUTH_RATE_LIMIT_PER_MIN), { viaEdge: !!env.EDGE_SECRET });

// Liveness for Fly's checks, which reach the machine directly: exempt from the edge guard.
router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Same answer, but behind the edge guard: www.paytag.dev/status probes this, so a Cloudflare /
// EDGE_SECRET mismatch (every real request refused) shows as the API being down.
router.get('/ping', (_req, res) => {
  res.json({ status: 'ok' });
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
