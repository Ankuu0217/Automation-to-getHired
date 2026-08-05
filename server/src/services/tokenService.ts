import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import type { IUser } from '../models/User';
import { env } from '../config/env';
import { sha256 } from '../utils/crypto';

export const ACCESS_COOKIE = 'jm_access';
export const REFRESH_COOKIE = 'jm_refresh';

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 10;

interface RefreshPayload {
  sub: string;
  jti: string;
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: ACCESS_TTL });
}

export function signRefreshToken(userId: string): string {
  const payload: RefreshPayload = { sub: userId, jti: crypto.randomUUID() };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

export function verifyAccessToken(token: string): { sub: string } {
  return jwt.verify(token, env.JWT_SECRET) as { sub: string };
}

export function verifyRefreshToken(token: string): RefreshPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshPayload;
}

export function refreshTokenHash(token: string): string {
  return sha256(token);
}

/** Store a refresh-token hash on the user, capping concurrent sessions. */
export async function storeRefreshToken(user: IUser, token: string): Promise<void> {
  const hashes = [...(user.refreshTokenHashes ?? []), refreshTokenHash(token)];
  user.refreshTokenHashes = hashes.slice(-MAX_SESSIONS);
  await user.save();
}

export async function removeRefreshToken(user: IUser, token: string): Promise<void> {
  const hash = refreshTokenHash(token);
  user.refreshTokenHashes = (user.refreshTokenHashes ?? []).filter((h) => h !== hash);
  await user.save();
}

export function hasRefreshToken(user: IUser, token: string): boolean {
  return (user.refreshTokenHashes ?? []).includes(refreshTokenHash(token));
}

const baseCookie = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: env.COOKIE_SECURE,
  path: '/',
};

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, { ...baseCookie, maxAge: 15 * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...baseCookie, maxAge: REFRESH_TTL_MS });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, baseCookie);
  res.clearCookie(REFRESH_COOKIE, baseCookie);
}
