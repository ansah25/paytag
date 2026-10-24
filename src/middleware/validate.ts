import { RequestHandler } from 'express';
import { ZodType, ZodTypeDef } from 'zod';

type Source = 'body' | 'query' | 'params';

export const validate =
  // Input is unknown: a schema may transform what it parses (a query string into a bigint).
  <T>(schema: ZodType<T, ZodTypeDef, unknown>, source: Source = 'body'): RequestHandler =>
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
