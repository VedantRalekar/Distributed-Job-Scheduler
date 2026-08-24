import express from 'express';
import { randomUUID } from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';

import {
  connectRedis
} from './redis.js';

import {
  config
} from './config.js';

import {
  rateLimiter
} from './middleware/rateLimiter.js';

import {
  notFound,
  errorHandler
} from './middleware/error.js';

import authRoutes
  from './routes/auth.js';

import projectRoutes
  from './routes/projects.js';

import queueRoutes
  from './routes/queues.js';

import jobRoutes
  from './routes/jobs.js';

import workerRoutes
  from './routes/workers.js';

import metricsRoutes
  from './routes/metrics.js';

import dlqRoutes
  from './routes/dlq.js';

import scheduleRoutes
  from './routes/schedules.js';

import {
  startScheduler
} from './scheduler.js';

import {
  query,
  pool
} from './db.js';

const app = express();

app.use(helmet());

app.use(
  cors({
    origin:
      config.corsOrigin === '*'
        ? true
        : config.corsOrigin
  })
);

app.use(
  express.json({
    limit: '1mb'
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(
  (req, res, next) => {
    res.setHeader(
      'X-Request-Id',
      randomUUID()
    );

    next();
  }
);

app.use(rateLimiter);

app.get(
  '/api/health',
  async (_req, res) => {
    res.json({
      success: true,

      data: {
        service: 'api',
        uptime:
          process.uptime()
      }
    });
  }
);

app.use(
  '/api/auth',
  authRoutes
);

app.use(
  '/api/projects',
  projectRoutes
);

app.use(
  '/api/queues',
  queueRoutes
);

app.use(
  '/api/jobs',
  jobRoutes
);

app.use(
  '/api/workers',
  workerRoutes
);

app.use(
  '/api/metrics',
  metricsRoutes
);

app.use(
  '/api/dlq',
  dlqRoutes
);

app.use(
  '/api/schedules',
  scheduleRoutes
);

app.use(
  express.static(
    'frontend'
  )
);

app.use(notFound);

app.use(errorHandler);

await query('SELECT 1');

await connectRedis();

startScheduler();

const server =
  app.listen(
    config.port,
    () => {
      console.log(
        `Scheduler API listening on http://localhost:${config.port}`
      );
    }
  );

async function shutdown() {
  server.close();

  await pool.end();

  process.exit(0);
}

process.on(
  'SIGINT',
  shutdown
);

process.on(
  'SIGTERM',
  shutdown
);