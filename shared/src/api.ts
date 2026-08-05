/** Standard API error envelope — every error response uses this shape. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Common error codes (extensible — later milestones add more). */
export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  BAD_REQUEST: 'BAD_REQUEST',
  DUPLICATE_APPLICATION: 'DUPLICATE_APPLICATION',
  OAUTH_NOT_CONFIGURED: 'OAUTH_NOT_CONFIGURED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
