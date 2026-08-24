import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 3000),

  databaseUrl: process.env.DATABASE_URL,

  redisUrl:
    process.env.REDIS_URL ||
    'redis://localhost:6379',

  jwtSecret: process.env.JWT_SECRET,

  jwtExpiresIn:
    process.env.JWT_EXPIRES_IN ||
    '1d',

  corsOrigin:
    process.env.CORS_ORIGIN ||
    'http://localhost:3000',

  rateLimitPerMinute:
    Number(process.env.RATE_LIMIT_PER_MINUTE || 120),

  workerPollMs:
    Number(process.env.WORKER_POLL_MS || 1000),

  workerHeartbeatMs:
    Number(process.env.WORKER_HEARTBEAT_MS || 5000),

  schedulerPollMs:
    Number(process.env.SCHEDULER_POLL_MS || 5000)
};

if (!config.databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

if (!config.jwtSecret) {
  throw new Error('JWT_SECRET is required');
}