import { RequestHandler } from 'express';
import { ZodSchema } from 'zod';

type Source = 'body' | 'query' | 'params';

export const validate =
  <T>(schema: ZodSchema<T>, source: Source = 'body'): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(result.error);
      return;
    }
    // Replace with parsed (and coerced) data
    (req as unknown as Record<Source, T>)[source] = result.data;
    next();
  };
