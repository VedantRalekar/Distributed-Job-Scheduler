import { Router } from 'express';
import { z } from 'zod';

import { authenticate } from '../middleware/auth.js';

import {
  asyncHandler
} from '../utils/asyncHandler.js';

import {
  createJob,
  createBatch,
  listJobs,
  getJob,
  retryDeadLetter
} from '../services/job.service.js';

import { query } from '../db.js';

import {
  HttpError
} from '../utils/httpError.js';

const router = Router();

router.use(authenticate);

const jobInput =
  z.object({
    queueId:
      z.string().uuid(),

    payload:
      z.record(
        z.string(),
        z.any()
      ),

    priority:
      z.number()
        .int()
        .min(-32768)
        .max(32767)
        .optional(),

    delayMs:
      z.number()
        .int()
        .nonnegative()
        .max(31536000000)
        .optional(),

    scheduledAt:
      z.string()
        .datetime()
        .optional(),

    dedupeKey:
      z.string()
        .max(200)
        .optional()
  })
  .refine(
    value =>
      !(
        value.delayMs !==
          undefined &&
        value.scheduledAt
      ),
    {
      message:
        'Use either delayMs or scheduledAt'
    }
  );

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body =
      jobInput.parse(
        req.body
      );

    const job =
      await createJob(
        req.user.sub,
        body
      );

    res.status(201).json({
      success: true,
      data: job
    });
  })
);

router.post(
  '/batch',
  asyncHandler(async (req, res) => {
    const body =
      z.object({
        queueId:
          z.string().uuid(),

        jobs:
          z.array(
            z.object({
              payload:
                z.record(
                  z.string(),
                  z.any()
                ),

              priority:
                z.number()
                  .int()
                  .optional(),

              delayMs:
                z.number()
                  .int()
                  .nonnegative()
                  .optional(),

              dedupeKey:
                z.string()
                  .max(200)
                  .optional()
            })
          )
          .min(1)
          .max(1000)
      }).parse(req.body);

    const jobs =
      await createBatch(
        req.user.sub,
        body
      );

    res.status(201).json({
      success: true,
      data: jobs
    });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const queueId =
      z.string()
        .uuid()
        .parse(req.query.queueId);

    const jobs =
      await listJobs(
        req.user.sub,
        {
          ...req.query,
          queueId
        }
      );

    res.json({
      success: true,
      data: jobs,
      pagination: {
        limit:
          Number(
            req.query.limit || 50
          ),

        offset:
          Number(
            req.query.offset || 0
          )
      }
    });
  })
);

router.get(
  '/:jobId',
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: await getJob(
        req.user.sub,
        req.params.jobId
      )
    });
  })
);

router.get(
  '/:jobId/logs',
  asyncHandler(async (req, res) => {
    const job =
      (
        await query(
          `
          SELECT j.id

          FROM jobs j

          JOIN queues q
            ON q.id = j.queue_id

          JOIN projects p
            ON p.id = q.project_id

          JOIN organization_members om
            ON om.organization_id =
               p.organization_id

          WHERE j.id = $1
          AND om.user_id = $2
          `,
          [
            req.params.jobId,
            req.user.sub
          ]
        )
      ).rows[0];

    if (!job) {
      throw new HttpError(
        404,
        'Job not found'
      );
    }

    const { rows } =
      await query(
        `
        SELECT
          l.*,
          e.attempt_no

        FROM job_logs l

        JOIN job_executions e
          ON e.id = l.execution_id

        WHERE e.job_id = $1

        ORDER BY l.logged_at ASC
        `,
        [req.params.jobId]
      );

    res.json({
      success: true,
      data: rows
    });
  })
);

router.post(
  '/dlq/:dlqId/retry',
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data:
        await retryDeadLetter(
          req.user.sub,
          req.params.dlqId
        )
    });
  })
);

export default router;