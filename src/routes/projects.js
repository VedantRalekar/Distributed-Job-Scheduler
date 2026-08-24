import { Router } from 'express';
import { z } from 'zod';

import { query } from '../db.js';
import {
  authenticate,
  requireRole
} from '../middleware/auth.js';

import {
  validate
} from '../middleware/validate.js';

import {
  asyncHandler
} from '../utils/asyncHandler.js';

import {
  HttpError
} from '../utils/httpError.js';

const router = Router();

router.use(authenticate);

const projectSchema =
  z.object({
    organizationId:
      z.string().uuid(),

    name:
      z.string()
        .min(2)
        .max(160)
  });

router.get(
  '/:organizationId',
  requireRole(
    'ADMIN',
    'OPERATOR',
    'VIEWER'
  ),
  asyncHandler(async (req, res) => {
    const { rows } =
      await query(
        `
        SELECT
          id,
          name,
          created_at
        FROM projects
        WHERE organization_id = $1
        ORDER BY created_at DESC
        `,
        [req.params.organizationId]
      );

    res.json({
      success: true,
      data: rows
    });
  })
);

router.post(
  '/',
  requireRole(
    'ADMIN',
    'OPERATOR'
  ),
  validate(projectSchema),
  asyncHandler(async (req, res) => {
    const { rows } =
      await query(
        `
        INSERT INTO projects(
          organization_id,
          name
        )
        VALUES($1,$2)
        RETURNING *
        `,
        [
          req.body.organizationId,
          req.body.name
        ]
      );

    res.status(201).json({
      success: true,
      data: rows[0]
    });
  })
);

router.post(
  '/:projectId/retry-policies',
  asyncHandler(async (req, res) => {
    const project =
      (
        await query(
          `
          SELECT
            p.organization_id
          FROM projects p
          WHERE p.id = $1
          `,
          [req.params.projectId]
        )
      ).rows[0];

    if (!project) {
      throw new HttpError(
        404,
        'Project not found'
      );
    }

    const membership =
      (
        await query(
          `
          SELECT role
          FROM organization_members
          WHERE organization_id = $1
          AND user_id = $2
          `,
          [
            project.organization_id,
            req.user.sub
          ]
        )
      ).rows[0];

    if (
      !membership ||
      !['ADMIN', 'OPERATOR']
        .includes(membership.role)
    ) {
      throw new HttpError(
        403,
        'Forbidden'
      );
    }

    const schema =
      z.object({
        name:
          z.string()
            .min(2)
            .max(100),

        maxAttempts:
          z.number()
            .int()
            .positive()
            .max(100),

        backoffStrategy:
          z.enum([
            'fixed',
            'linear',
            'exponential'
          ]),

        baseDelayMs:
          z.number()
            .int()
            .nonnegative(),

        maxDelayMs:
          z.number()
            .int()
            .nonnegative(),

        jitter:
          z.boolean()
      });

    const body =
      schema.parse(req.body);

    const { rows } =
      await query(
        `
        INSERT INTO retry_policies(
          project_id,
          name,
          max_attempts,
          backoff_strategy,
          base_delay_ms,
          max_delay_ms,
          jitter
        )
        VALUES(
          $1,$2,$3,$4,$5,$6,$7
        )
        RETURNING *
        `,
        [
          req.params.projectId,
          body.name,
          body.maxAttempts,
          body.backoffStrategy,
          body.baseDelayMs,
          Math.max(
            body.baseDelayMs,
            body.maxDelayMs
          ),
          body.jitter
        ]
      );

    res.status(201).json({
      success: true,
      data: rows[0]
    });
  })
);

export default router;