import { RequestHandler } from 'express';
import { getSessionVersion, verifyToken, JwtPayload } from '../services/authService';
import { UnauthorizedError } from '../utils/errors';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: JwtPayload;
  }
}

/**
 * Bearer JWT, then the account's current session_version: a token issued before a
 * "sign out everywhere" carries an older version and is refused.
 *
 * A wallet with no account (no users row) has nothing to compare against, so its token can't be
 * revoked and stays valid until it expires (JWT_EXPIRES_IN, 24h). It can still reach real actions,
 * notably /register; the lifetime cap is the only bound there.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(new UnauthorizedError('Missing bearer token', 'TOKEN_MISSING'));
    return;
  }

  try {
    const auth = verifyToken(header.slice('Bearer '.length).trim());
    const current = await getSessionVersion(auth.sub);
    if (current !== null && current !== auth.sv) {
      throw new UnauthorizedError('This session was signed out. Sign in again.', 'TOKEN_REVOKED');
    }
    req.auth = auth;
    next();
  } catch (err) {
    next(err);
  }
};
