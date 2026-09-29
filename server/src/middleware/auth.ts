import type { RequestHandler } from 'express';
import { ErrorCodes, errorBody } from './error';
import { ACCESS_COOKIE, verifyAccessToken } from '../services/tokenService';
import { User } from '../models/User';
import { sha256 } from '../utils/crypto';

/** Browser-extension tokens: `ghx_` + 64 hex, stored only as a SHA-256 hash. */
export const EXTENSION_TOKEN_PREFIX = 'ghx_';

/**
 * Require an authenticated user; attaches req.userId. Two credentials:
 *  - the web app's access-token cookie (normal case);
 *  - `Authorization: Bearer ghx_…` from the GetHired Chrome extension.
 */
/** Least privilege: the extension can only capture posts and read its own result. */
function extensionMayCall(method: string, url: string): boolean {
  const path = url.split('?')[0];
  return (
    (method === 'POST' && (path === '/api/v1/jobs/upload' || path === '/api/v1/jobs/import')) ||
    (method === 'GET' && (path === '/api/v1/auth/me' || /^\/api\/v1\/jobs\/[a-f0-9]{24}$/.test(path)))
  );
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization;
  if (header?.startsWith(`Bearer ${EXTENSION_TOKEN_PREFIX}`)) {
    if (!extensionMayCall(req.method, req.originalUrl)) {
      res.status(403).json(errorBody(ErrorCodes.FORBIDDEN, 'The extension token cannot be used for this action'));
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    User.findOne({ extensionTokenHash: sha256(token) })
      .select('_id')
      .then((user) => {
        if (!user) {
          res.status(401).json(errorBody(ErrorCodes.UNAUTHORIZED, 'Extension token is invalid or was revoked'));
          return;
        }
        req.userId = String(user._id);
        next();
      })
      .catch(next);
    return;
  }
  const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  if (!token) {
    res.status(401).json(errorBody(ErrorCodes.UNAUTHORIZED, 'Authentication required'));
    return;
  }
  try {
    const { sub } = verifyAccessToken(token);
    req.userId = sub;
    next();
  } catch {
    res.status(401).json(errorBody(ErrorCodes.UNAUTHORIZED, 'Invalid or expired token'));
  }
};
