import { RequestHandler } from 'express';
import { verifyToken, JwtPayload } from '../services/authService';
import { UnauthorizedError } from '../utils/errors';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: JwtPayload;
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(new UnauthorizedError('Missing bearer token'));
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  try {
    req.auth = verifyToken(token);
    next();
  } catch (err) {
    next(err);
  }
};
