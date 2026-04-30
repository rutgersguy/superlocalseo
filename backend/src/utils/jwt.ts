import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AccessTokenPayload {
  userId: string;
  role: string;
}

export interface RefreshTokenPayload {
  userId: string;
  tokenId: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.accessExpiry } as jwt.SignOptions);
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpiry } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.jwt.secret) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, config.jwt.refreshSecret) as RefreshTokenPayload;
}
