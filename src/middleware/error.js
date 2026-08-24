import { redis } from '../redis.js';
import { config } from '../config.js';
import { HttpError } from '../utils/httpError.js';

export async function rateLimiter(
  req,
  _res,
  next
) {
  try {
    const identity =
      req.user?.sub ||
      req.ip ||
      'anonymous';

    const bucket =
      Math.floor(Date.now() / 60000);

    const key =
      `rate:${identity}:${bucket}`;

    const count =
      await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, 61);
    }

    if (
      count >
      config.rateLimitPerMinute
    ) {
      throw new HttpError(
        429,
        'Rate limit exceeded'
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}