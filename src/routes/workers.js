import { Router } from 'express';

import { authenticate } from '../middleware/auth.js';

import {
  asyncHandler
} from '../utils/asyncHandler.js';

import { query } from '../db.js';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } =
      await query(
        `
        SELECT
          w.*,
          h.heartbeat_at,
          h.load_pct,
          h.active_executions,
          q.name queue_name

        FROM workers w

        JOIN queues q
          ON q.id = w.queue_id

        JOIN projects p
          ON p.id = q.project_id

        JOIN organization_members om
          ON om.organization_id =
             p.organization_id

        LEFT JOIN worker_heartbeats h
          ON h.worker_id = w.id

        WHERE om.user_id = $1

        ORDER BY
          w.last_seen_at DESC
        `,
        [req.user.sub]
      );

    res.json({
      success: true,
      data: rows
    });
  })
);

export default router;