import type { RequestHandler } from 'express';
import type { ZodSchema } from 'zod';
import { ErrorCodes, errorBody } from './error';

/**
 * Validate req.body against a zod schema. On success, req.body is replaced
 * with the parsed (typed, coerced, stripped) value.
 */
export function validate<T>(schema: ZodSchema<T>): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json(
        errorBody(ErrorCodes.VALIDATION_ERROR, 'Validation failed', result.error.flatten()),
      );
      return;
    }
    req.body = result.data;
    next();
  };
}
