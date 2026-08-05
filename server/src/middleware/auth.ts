import type { RequestHandler } from 'express';
import { ErrorCodes, errorBody } from './error';
import { ACCESS_COOKIE, verifyAccessToken } from '../services/tokenService';

/** Require a valid access-token cookie; attaches req.userId. */
export const requireAuth: RequestHandler = (req, res, next) => {
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
