import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ErrorCodes, type ApiError, type ErrorCode } from '@jobmail/shared';
import { logger } from '../utils/logger';

export { ErrorCodes };

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: ErrorCode | string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorBody(code: string, message: string, details?: unknown): ApiError {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(errorBody(ErrorCodes.NOT_FOUND, `Route not found: ${req.method} ${req.path}`));
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json(errorBody(err.code, err.message, err.details));
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json(
      errorBody(ErrorCodes.VALIDATION_ERROR, 'Validation failed', err.flatten()),
    );
    return;
  }
  // Multer errors (file size, etc.)
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json(errorBody(ErrorCodes.BAD_REQUEST, 'File too large (max 10 MB)'));
      return;
    }
  }
  logger.error({ err, path: req.path }, 'Unhandled error');
  res.status(500).json(errorBody(ErrorCodes.INTERNAL, 'Internal server error'));
};
