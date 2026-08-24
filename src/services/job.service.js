import {
  query,
  transaction
} from '../db.js';

import {
  HttpError
} from '../utils/httpError.js';

export async function assertQueueAccess(
  queueId,
  userId,
  write = false
) {
  const { rows } =
    await query(
      `
      SELECT
        q.id,
        q.project_id,
        p.organization_id,
        om.role
      FROM queues q

      JOIN projects p
        ON p.id = q.project_id

      JOIN organization_members om
        ON om.organization_id =
           p.organization_id

      WHERE q.id = $1
      AND om.user_id = $2
      `,
      [
        queueId,
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

export async function createJob(
  userId,
  body
) {
  await assertQueueAccess(
    body.queueId,
    userId,
    true
  );

  const delay =
    body.delayMs || 0;

  const availableAt =
    body.scheduledAt
      ? new Date(body.scheduledAt)
      : new Date(
          Date.now() + delay
        );

  const status =
    availableAt.getTime() > Date.now()
      ? 'SCHEDULED'
      : 'QUEUED';

  try {
    const { rows } =
      await query(
        `
        INSERT INTO jobs(
          queue_id,
          dedupe_key,
          payload,
          priority,
          status,
          available_at
        )
        VALUES(
          $1,$2,$3,$4,$5,$6
        )
        RETURNING *
        `,
        [
          body.queueId,
          body.dedupeKey || null,
          body.payload,
          body.priority || 0,
          status,
          availableAt
        ]
      );

    return rows[0];
  } catch (error) {
    if (error.code === '23505') {
      throw new HttpError(
        409,
        'Duplicate dedupe key for queue'
      );
    }

    throw error;
  }
}

export async function createBatch(
  userId,
  body
) {
  await assertQueueAccess(
    body.queueId,
    userId,
    true
  );

  return transaction(
    async client => {
      const result = [];

      for (const item of body.jobs) {
        const delay =
          item.delayMs || 0;

        const availableAt =
          new Date(
            Date.now() + delay
          );

        const status =
          delay > 0
            ? 'SCHEDULED'
            : 'QUEUED';

        const { rows } =
          await client.query(
            `
            INSERT INTO jobs(
              queue_id,
              dedupe_key,
              payload,
              priority,
              status,
              available_at
            )
            VALUES(
              $1,$2,$3,$4,$5,$6
            )
            RETURNING *
            `,
            [
              body.queueId,
              item.dedupeKey || null,
              item.payload,
              item.priority || 0,
              status,
              availableAt
            ]
          );

        result.push(rows[0]);
      }

      return result;
    }
  );
}

export async function listJobs(
  userId,
  queryParams
) {
  await assertQueueAccess(
    queryParams.queueId,
    userId
  );

  const limit =
    Math.min(
      Number(
        queryParams.limit || 50
      ),
      100
    );

  const offset =
    Math.max(
      Number(
        queryParams.offset || 0
      ),
      0
    );

  const params = [
    queryParams.queueId
  ];

  let where =
    'j.queue_id=$1';

  if (queryParams.status) {
    params.push(
      queryParams.status
    );

    where +=
      ` AND j.status=$${params.length}`;
  }

  if (
    queryParams.priority !==
    undefined
  ) {
    params.push(
      Number(
        queryParams.priority
      )
    );

    where +=
      ` AND j.priority=$${params.length}`;
  }

  params.push(
    limit,
    offset
  );

  const { rows } =
    await query(
      `
      SELECT
        j.*,
        COALESCE(
          e.attempts,
          0
        )::int AS attempts

      FROM jobs j

      LEFT JOIN (
        SELECT
          job_id,
          count(*) attempts
        FROM job_executions
        GROUP BY job_id
      ) e
        ON e.job_id = j.id

      WHERE ${where}

      ORDER BY
        j.priority DESC,
        j.created_at DESC

      LIMIT $${params.length - 1}
      OFFSET $${params.length}
      `,
      params
    );

  return rows;
}

export async function getJob(
  userId,
  jobId
) {
  const { rows } =
    await query(
      `
      SELECT
        j.*,
        q.name queue_name,
        p.name project_name,
        p.organization_id

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
        jobId,
        userId
      ]
    );

  if (!rows[0]) {
    throw new HttpError(
      404,
      'Job not found'
    );
  }

  const executions =
    (
      await query(
        `
        SELECT
          e.*,
          w.hostname

        FROM job_executions e

        LEFT JOIN workers w
          ON w.id = e.worker_id

        WHERE e.job_id = $1

        ORDER BY
          e.attempt_no DESC
        `,
        [jobId]
      )
    ).rows;

  return {
    ...rows[0],
    executions
  };
}

export async function retryDeadLetter(
  userId,
  dlqId
) {
  return transaction(
    async client => {
      const dlq =
        (
          await client.query(
            `
            SELECT d.*

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

            FOR UPDATE
            `,
            [
              dlqId,
              userId
            ]
          )
        ).rows[0];

      if (!dlq) {
        throw new HttpError(
          404,
          'DLQ entry not found or already requeued'
        );
      }

      const job =
        (
          await client.query(
            `
            UPDATE jobs
            SET
              status = 'QUEUED',
              available_at = now(),
              completed_at = NULL

            WHERE id = $1

            RETURNING *
            `,
            [dlq.job_id]
          )
        ).rows[0];

      await client.query(
        `
        UPDATE dead_letter_entries
        SET requeued_at = now()
        WHERE id = $1
        `,
        [dlqId]
      );

      return job;
    }
  );
}