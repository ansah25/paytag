import { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, code: err.errorCode });
    return;
  }

  // A malformed %-escape in a route parameter: Express raises a URIError with status 400.
  if (err instanceof URIError) {
    res.status(400).json({ error: 'Malformed URL', code: 'MALFORMED_URL' });
    return;
  }

  // express.json errors (http-errors with expose: true) are the client's fault. Fixed messages:
  // the parser's own text can describe internals, so it's never echoed.
  const parser = err as { type?: unknown; status?: unknown; expose?: unknown };
  if (parser?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body', code: 'INVALID_JSON' });
    return;
  }
  if (parser?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' });
    return;
  }
  if (parser?.expose === true && typeof parser.status === 'number' && parser.status >= 400 && parser.status < 500) {
    res.status(parser.status).json({ error: 'Unsupported or malformed request body', code: 'BAD_REQUEST_BODY' });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.flatten().fieldErrors,
    });
    return;
  }

  logger.error('unhandled', { path: req.path, err: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
};
