import { Router } from 'express';

import {
  authenticate
} from '../middleware/auth.js';

import {
  asyncHandler
} from '../utils/asyncHandler.js';

import {
  query
} from '../db.js';

import {
  HttpError
} from '../utils/httpError.js';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } =
      await query(
        `
        SELECT
          d.*,
          q.name queue_name,
          j.status job_status

        FROM dead_letter_entries d

        JOIN queues q
          ON q.id = d.queue_id

        JOIN jobs j
          ON j.id = d.job_id

        JOIN projects p
          ON p.id = q.project_id

        JOIN organization_members om
          ON om.organization_id =
             p.organization_id

        WHERE om.user_id = $1

        AND d.requeued_at IS NULL

        ORDER BY d.failed_at DESC

        LIMIT 100
        `,
        [req.user.sub]
      );

    res.json({
      success: true,
      data: rows
    });
  })
);

router.post(
  '/:id/requeue',
  asyncHandler(async (req, res) => {
    const entry =
      (
        await query(
          `
          SELECT
            d.id,
            d.job_id

          FROM dead_letter_entries d

          JOIN queues q
            ON q.id = d.queue_id

          JOIN projects p
            ON p.id = q.project_id

          JOIN organization_members om
            ON om.organization_id =
               p.organization_id

          WHERE d.id = $1

          AND om.user_id = $2

          AND d.requeued_at IS NULL
          `,
          [
            req.params.id,
            req.user.sub
          ]
        )
      ).rows[0];

    if (!entry) {
      throw new HttpError(
        404,
        'DLQ entry not found'
      );
    }

    await query(
      `
      UPDATE jobs

      SET
        status = 'QUEUED',
        available_at = now(),
        completed_at = NULL

      WHERE id = $1
      `,
      [entry.job_id]
    );

    await query(
      `
      UPDATE dead_letter_entries
      SET requeued_at = now()
      WHERE id = $1
      `,
      [entry.id]
    );

    res.json({
      success: true,
      message: 'Job requeued'
    });
  })
);

export default router;