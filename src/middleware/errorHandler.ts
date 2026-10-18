import { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, code: err.errorCode });
    return;
  }

  // express.json errors: malformed JSON or a body over the limit are the client's fault.
  const parserType = (err as { type?: unknown })?.type;
  if (parserType === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body', code: 'INVALID_JSON' });
    return;
  }
  if (parserType === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' });
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
