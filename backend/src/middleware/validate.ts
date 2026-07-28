import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { ValidationError } from '../lib/errors';

type Source = 'body' | 'query' | 'params';

/** Validate a request part against a zod schema; on failure → 400 VALIDATION_ERROR with field details. */
export function validate(schema: ZodTypeAny, source: Source = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.') || source,
        message: i.message,
      }));
      return next(new ValidationError('Request validation failed', details));
    }
    // Replace with the parsed/coerced value.
    req[source] = result.data;
    next();
  };
}
