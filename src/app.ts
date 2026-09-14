import express, { Application, RequestHandler } from 'express';
import cors, { CorsOptions } from 'cors';
import { env } from './config/env';
import { router } from './routes';
import { errorHandler } from './middleware/errorHandler';

const buildCorsOptions = (): CorsOptions => {
  if (!env.CORS_ORIGIN) {
    // Dev / unset: allow any origin
    return {};
  }
  const allowed = env.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return {
    origin: (origin, cb) => {
      // Same-origin / curl / server-to-server requests have no Origin header
      if (!origin) return cb(null, true);
      cb(null, allowed.includes(origin));
    },
  };
};

// Public read endpoints — callable from any origin so the @paytagdev/sdk works
// in browsers regardless of where it's embedded.
const PUBLIC_READ_PATHS = /^\/(health|resolve\/|available\/)/;
const PUBLIC_CORS: CorsOptions = { origin: '*', methods: ['GET'] };

const splitCors = (): RequestHandler => {
  const publicCors = cors(PUBLIC_CORS);
  const restrictedCors = cors(buildCorsOptions());
  return (req, res, next) => {
    if (PUBLIC_READ_PATHS.test(req.path)) {
      return publicCors(req, res, next);
    }
    return restrictedCors(req, res, next);
  };
};

export const createApp = (): Application => {
  const app = express();

  // Parse query strings with Node's querystring instead of qs. qs (pinned by
  // Express 4) has open DoS advisories, and the API only reads flat params
  // such as ?wallet=, so nested/array query syntax isn't needed.
  app.set('query parser', 'simple');

  app.use(splitCors());
  app.use(express.json({ limit: '100kb' }));

  app.use(router);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found', code: 404 });
  });

  app.use(errorHandler);

  return app;
};
