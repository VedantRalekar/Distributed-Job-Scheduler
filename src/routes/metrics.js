import { Router } from 'express';

import {
  authenticate
} from '../middleware/auth.js';

import {
  asyncHandler
} from '../utils/asyncHandler.js';

import { query } from '../db.js';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const orgId =
      req.user.organizationId;

    const [
      jobs,
      workers,
      queues,
      throughput
    ] = await Promise.all([
      query(
        `
        SELECT
          j.status,
          count(*)::int count

        FROM jobs j

        JOIN queues q
          ON q.id = j.queue_id

        JOIN projects p
          ON p.id = q.project_id

        WHERE p.organization_id = $1

        GROUP BY j.status
        `,
        [orgId]
      ),

      query(
        `
        SELECT count(*)::int count

        FROM workers w

        JOIN queues q
          ON q.id = w.queue_id

        JOIN projects p
          ON p.id = q.project_id

        WHERE p.organization_id = $1

        AND w.status = 'RUNNING'

        AND w.last_seen_at >
            now() - interval '30 seconds'
        `,
        [orgId]
      ),

      query(
        `
        SELECT
          count(*)::int total,

          count(*)
            FILTER(
              WHERE q.paused
            )::int paused

        FROM queues q

        JOIN projects p
          ON p.id = q.project_id

        WHERE p.organization_id = $1
        `,
        [orgId]
      ),

      query(
        `
        SELECT
          date_trunc(
            'minute',
            finished_at
          ) minute,

          count(*)::int completed

        FROM job_executions e

        JOIN jobs j
          ON j.id = e.job_id

        JOIN queues q
          ON q.id = j.queue_id

        JOIN projects p
          ON p.id = q.project_id

        WHERE p.organization_id = $1

        AND e.status = 'COMPLETED'

        AND finished_at >
            now() - interval '60 minutes'

        GROUP BY 1

        ORDER BY 1
        `,
        [orgId]
      )
    ]);

    res.json({
      success: true,

      data: {
        jobs:
          Object.fromEntries(
            jobs.rows.map(
              row => [
                row.status,
                row.count
              ]
            )
          ),

        activeWorkers:
          workers.rows[0].count,

        queues:
          queues.rows[0],

        throughput:
          throughput.rows
      }
    });
  })
);

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const db =
      await query('SELECT 1');

    res.json({
      success: true,

      data: {
        database:
          db.rowCount === 1,

        uptime:
          process.uptime(),

        timestamp:
          new Date().toISOString()
      }
    });
  })
);

export default router;