import { RequestHandler } from 'express';
import { z } from 'zod';
import * as authService from '../services/authService';
import { BadRequestError, UnauthorizedError } from '../utils/errors';
import { MAX_LEN, bounded } from './limits';

const domainSchema = z
  .string()
  .max(MAX_LEN.domain)
  .regex(/^[a-z0-9.-]+(:\d{1,5})?$/, 'domain must be host[:port]');

export const nonceQuerySchema = z.object({
  wallet: z.string().min(1, 'wallet is required').max(MAX_LEN.wallet),
  // The web app's own host (window.location.host); must be on the SIWE allowlist.
  domain: domainSchema.optional(),
});

export const verifyBodySchema = z.object({
  wallet: bounded(MAX_LEN.wallet),
  signature: bounded(MAX_LEN.authSignature),
  // The nonce this signature is over. Optional in the schema only so that an outdated client gets
  // a clear CLIENT_OUTDATED from the service instead of a generic validation error.
  nonce: z.string().regex(/^[0-9a-f]{80}$/).optional(),
  domain: domainSchema.optional(),
});

const originOf = (header: string | string[] | undefined): string | undefined =>
  typeof header === 'string' ? header : undefined;

export const getNonce: RequestHandler = async (req, res, next) => {
  try {
    const { wallet, domain } = req.query as z.infer<typeof nonceQuerySchema>;
    if (!domain) {
      throw new BadRequestError('This page is out of date. Reload the page and sign in again.', 'CLIENT_OUTDATED');
    }
    res.json(await authService.createNonce(wallet, domain, originOf(req.headers.origin)));
  } catch (err) {
    next(err);
  }
};

export const verify: RequestHandler = async (req, res, next) => {
  try {
    const { wallet, signature, nonce, domain } = req.body as z.infer<typeof verifyBodySchema>;
    const { token, wallet: normalized } = await authService.verifySignatureAndIssueToken(
      wallet,
      signature,
      nonce,
      domain,
      originOf(req.headers.origin),
    );
    res.json({ token, wallet: normalized });
  } catch (err) {
    next(err);
  }
};

export const logoutAll: RequestHandler = async (req, res, next) => {
  try {
    if (!req.auth) throw new UnauthorizedError('Not signed in', 'TOKEN_MISSING');
    await authService.revokeAllSessions(req.auth.sub);
    res.json({ revoked: true });
  } catch (err) {
    next(err);
  }
};
