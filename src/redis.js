import { createClient } from 'redis';
import { config } from './config.js';

export const redis = createClient({
  url: config.redisUrl
});

redis.on('error', error => {
  console.error('[redis]', error);
});

export async function connectRedis() {
  if (!redis.isOpen) {
    await redis.connect();
  }
}