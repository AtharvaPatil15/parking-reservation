import type { CookieOptions } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { sendSuccess } from '../../lib/response';
import { toUserProfile } from '../../lib/dto';
import { env } from '../../config/env';
import * as service from './auth.service';
import type { RegisterInput } from './auth.schema';

const COOKIE = 'refreshToken';
const cookieOpts = (expires: Date): CookieOptions => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/v1/auth',
  expires,
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  const r = await service.login(email, password, req.ip);
  res.cookie(COOKIE, r.refreshToken, cookieOpts(r.refreshExpiresAt));
  sendSuccess(res, {
    accessToken: r.accessToken,
    tokenType: r.tokenType,
    expiresIn: r.expiresIn,
    user: r.user,
  });
});

export const register = asyncHandler(async (req, res) => {
  const user = await service.register(req.body as RegisterInput);
  sendSuccess(res, toUserProfile(user), 201);
});

export const refresh = asyncHandler(async (req, res) => {
  const r = await service.refresh(req.cookies?.[COOKIE], req.ip);
  res.cookie(COOKIE, r.refreshToken, cookieOpts(r.refreshExpiresAt));
  sendSuccess(res, { accessToken: r.accessToken, tokenType: r.tokenType, expiresIn: r.expiresIn });
});

export const logout = asyncHandler(async (req, res) => {
  await service.logout(req.cookies?.[COOKIE]);
  res.clearCookie(COOKIE, { path: '/api/v1/auth' });
  sendSuccess(res, { message: 'Logged out' });
});
