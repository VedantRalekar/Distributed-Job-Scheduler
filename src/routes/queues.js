import { Router } from 'express';
import { z } from 'zod';

import { query } from '../db.js';
import { authenticate } from '../middleware/auth.js';

import {
  asyncHandler
} from '../utils/asyncHandler.js';

import {
  HttpError
} from '../utils/httpError.js';

const router = Router();

router.use(authenticate);

async function projectAccess(
  projectId,
  userId,
  write = false
) {
  const { rows } =
    await query(
      `
      SELECT
        p.organization_id,
        om.role
      FROM projects p
      JOIN organization_members om
        ON om.organization_id =
           p.organization_id
      WHERE p.id = $1
      AND om.user_id = $2
      `,
      [
        projectId,
        userId
      ]
    );

  if (
    !rows[0] ||
    (
      write &&
      !['ADMIN', 'OPERATOR']
        .includes(rows[0].role)
    )
  ) {
    throw new HttpError(
      403,
      'Forbidden'
    );
  }

  return rows[0];
}

router.get(
  '/project/:projectId',
  asyncHandler(async (req, res) => {
    await projectAccess(
      req.params.projectId,
      req.user.sub
    );

    const { rows } =
      await query(
        `
        SELECT
          q.*,

          count(j.id)::int
            AS total_jobs,

          count(j.id)
            FILTER(
              WHERE j.status IN(
                'QUEUED',
                'SCHEDULED',
                'CLAIMED',
                'RUNNING'
              )
            )::int AS active_jobs,

          count(j.id)
            FILTER(
              WHERE j.status = 'COMPLETED'
            )::int AS completed_jobs,

          count(j.id)
            FILTER(
              WHERE j.status = 'FAILED'
            )::int AS failed_jobs

        FROM queues q

        LEFT JOIN jobs j
          ON j.queue_id = q.id

        WHERE q.project_id = $1

        GROUP BY q.id

        ORDER BY q.created_at DESC
        `,
        [req.params.projectId]
      );

    res.json({
      success: true,
      data: rows
    });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body =
      z.object({
        projectId:
          z.string().uuid(),

        name:
          z.string()
            .min(1)
            .max(120),

        concurrencyLimit:
          z.number()
            .int()
            .positive()
            .max(1000),

        retryPolicyId:
          z.string()
            .uuid()
            .nullable()
            .optional()
      }).parse(req.body);

    await projectAccess(
      body.projectId,
      req.user.sub,
      true
    );

    const { rows } =
      await query(
        `
        INSERT INTO queues(
          project_id,
          name,
          concurrency_limit,
          retry_policy_id
        )
        VALUES($1,$2,$3,$4)
        RETURNING *
        `,
        [
          body.projectId,
          body.name,
          body.concurrencyLimit,
          body.retryPolicyId || null
        ]
      );

    res.status(201).json({
      success: true,
      data: rows[0]
    });
  })
);

router.patch(
  '/:queueId',
  asyncHandler(async (req, res) => {
    const queue =
      (
        await query(
          `
          SELECT
            q.*,
            p.organization_id
          FROM queues q
          JOIN projects p
            ON p.id = q.project_id
          WHERE q.id = $1
          `,
          [req.params.queueId]
        )
      ).rows[0];

    if (!queue) {
      throw new HttpError(
        404,
        'Queue not found'
      );
    }

    const member =
      (
        await query(
          `
          SELECT role
          FROM organization_members
          WHERE organization_id = $1
          AND user_id = $2
          `,
          [
            queue.organization_id,
            req.user.sub
          ]
        )
      ).rows[0];

    if (
      !member ||
      !['ADMIN', 'OPERATOR']
        .includes(member.role)
    ) {
      throw new HttpError(
        403,
        'Forbidden'
      );
    }

    const body =
      z.object({
        concurrencyLimit:
          z.number()
            .int()
            .positive()
            .max(1000)
            .optional(),

        retryPolicyId:
          z.string()
            .uuid()
            .nullable()
            .optional(),

        paused:
          z.boolean()
            .optional()
      }).parse(req.body);

    const { rows } =
      await query(
        `
        UPDATE queues
        SET
          concurrency_limit =
            COALESCE(
              $1,
              concurrency_limit
            ),

          retry_policy_id =
            COALESCE(
              $2,
              retry_policy_id
            ),

          paused =
            COALESCE(
              $3,
              paused
            )

        WHERE id = $4

        RETURNING *
        `,
        [
          body.concurrencyLimit ?? null,
          body.retryPolicyId === undefined
            ? null
            : body.retryPolicyId,
          body.paused ?? null,
          req.params.queueId
        ]
      );

    res.json({
      success: true,
      data: rows[0]
    });
  })
);

router.post(
  '/:queueId/pause',
  asyncHandler(
    async (req, res) => {
      await setPause(
        req,
        res,
        true
      );
    }
  )
);

router.post(
  '/:queueId/resume',
  asyncHandler(
    async (req, res) => {
      await setPause(
        req,
        res,
        false
      );
    }
  )
);

async function setPause(
  req,
  res,
  paused
) {
  const queue =
    (
      await query(
        `
        SELECT
          q.*,
          p.organization_id
        FROM queues q
        JOIN projects p
          ON p.id = q.project_id
        WHERE q.id = $1
        `,
        [req.params.queueId]
      )
    ).rows[0];

  if (!queue) {
    throw new HttpError(
      404,
      'Queue not found'
    );
  }

  const member =
    (
      await query(
        `
        SELECT role
        FROM organization_members
        WHERE organization_id = $1
        AND user_id = $2
        `,
        [
          queue.organization_id,
          req.user.sub
        ]
      )
    ).rows[0];

  if (
    !member ||
    !['ADMIN', 'OPERATOR']
      .includes(member.role)
  ) {
    throw new HttpError(
      403,
      'Forbidden'
    );
  }

  const { rows } =
    await query(
      `
      UPDATE queues
      SET paused = $1
      WHERE id = $2
      RETURNING *
      `,
      [
        paused,
        queue.id
      ]
    );

  res.json({
    success: true,
    data: rows[0]
  });
}

export default router;