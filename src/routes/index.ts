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
const publicReads = rateLimit(new RateLimiter(env.PUBLIC_RATE_LIMIT_PER_MIN));

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get(
  '/auth/nonce',
  validate(authController.nonceQuerySchema, 'query'),
  authController.getNonce,
);

router.post(
  '/auth/verify',
  validate(authController.verifyBodySchema),
  authController.verify,
);

router.post(
  '/register',
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
