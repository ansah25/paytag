import { Router } from 'express';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import * as authController from '../controllers/authController';
import * as userController from '../controllers/userController';
import * as walletController from '../controllers/walletController';
import * as availabilityController from '../controllers/availabilityController';

export const router = Router();

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

router.post(
  '/add-address',
  requireAuth,
  validate(walletController.addAddressBodySchema),
  walletController.addAddress,
);

router.get(
  '/resolve/:username',
  validate(walletController.resolveParamsSchema, 'params'),
  walletController.resolve,
);

router.get(
  '/available/:username',
  validate(availabilityController.availabilityParamsSchema, 'params'),
  availabilityController.checkAvailability,
);
