import { createHash } from 'crypto';

import type { LogContext } from './logger';
import { logWarn } from './logger';

type RateLimitConfig = {
  limit: number;
  windowMs: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetMs: number;
};

type SessionLike = {
  user?: {
    email?: string | null;
  } | null;
};

const rateLimitStore = new Map<string, number[]>();

const hashValue = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 16);

const getClientIp = (request: Request) => {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0]?.trim();
  }
  return request.headers.get('x-real-ip');
};

export const getRateLimitKey = (request: Request, session?: SessionLike | null) => {
  const email = session?.user?.email?.trim();
  if (email) {
    return `user:${email.toLowerCase()}`;
  }

  const ip = getClientIp(request);
  if (ip) {
    return `ip:${hashValue(ip)}`;
  }

  return 'ip:unknown';
};

export const checkRateLimit = (
  key: string,
  config: RateLimitConfig,
  ctx?: LogContext,
): RateLimitResult => {
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const timestamps = (rateLimitStore.get(key) ?? []).filter((ts) => ts > windowStart);

  if (timestamps.length >= config.limit) {
    const resetMs = timestamps[0] + config.windowMs - now;
    rateLimitStore.set(key, timestamps);
    if (ctx) {
      const keyType = key.startsWith('user:') ? 'user' : key.startsWith('ip:') ? 'ip' : 'unknown';
      logWarn(ctx, 'rate_limit_exceeded', {
        keyType,
        windowMs: config.windowMs,
        limit: config.limit,
      });
    }
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.max(resetMs, 0),
    };
  }

  timestamps.push(now);
  rateLimitStore.set(key, timestamps);

  return {
    allowed: true,
    remaining: Math.max(config.limit - timestamps.length, 0),
    resetMs: timestamps[0] + config.windowMs - now,
  };
};
