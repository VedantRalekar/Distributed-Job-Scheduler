import os from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  query,
  transaction,
  pool
} from '../src/db.js';

import {
  config
} from '../src/config.js';

import {
  connectRedis,
  redis
} from '../src/redis.js';

import {
  executePayload
} from './executor.js';

import {
  log
} from '../src/utils/logger.js';

import {
  calculateRetryDelay
} from '../src/utils/retry.js';

const workerId =
  process.env.WORKER_ID ||
  randomUUID();

const queueId =
  process.env.WORKER_QUEUE_ID;

const capacity =
  Number(
    process.env.WORKER_CAPACITY ||
      5
  );

if (!queueId) {
  throw new Error(
    'WORKER_QUEUE_ID is required'
  );
}

let shuttingDown = false;
let active = 0;
let timer;

async function register() {
  await query(
    `
    INSERT INTO workers(
      id,
      queue_id,
      hostname,
      status,
      capacity
    )
    VALUES(
      $1,
      $2,
      $3,
      'RUNNING',
      $4
    )

    ON CONFLICT(id)

    DO UPDATE SET
      status = 'RUNNING',
      last_seen_at = now(),
      capacity = EXCLUDED.capacity
    `,
    [
      workerId,
      queueId,
      os.hostname(),
      capacity
    ]
  );

  await heartbeat();
}

async function heartbeat() {
  await query(
    `
    INSERT INTO worker_heartbeats(
      worker_id,
      heartbeat_at,
      load_pct,
      active_executions
    )
    VALUES(
      $1,
      now(),
      $2,
      $3
    )

    ON CONFLICT(worker_id)

    DO UPDATE SET
      heartbeat_at = now(),
      load_pct = $2,
      active_executions = $3
    `,
    [
      workerId,
      Math.round(
        (active / capacity) *
          100
      ),
      active
    ]
  );

  await query(
    `
    UPDATE workers

    SET
      last_seen_at = now(),
      status = $2

    WHERE id = $1
    `,
    [
      workerId,
      shuttingDown
        ? 'DRAINING'
        : 'RUNNING'
    ]
  );
}

async function claimJob() {
  if (
    shuttingDown ||
    active >= capacity
  ) {
    return null;
  }

  return transaction(
    async client => {
      const candidate =
        (
          await client.query(
            `
            WITH candidate AS (
              SELECT j.id

              FROM jobs j

              JOIN queues q
                ON q.id = j.queue_id

              WHERE j.queue_id = $1

              AND q.paused = false

              AND j.status IN(
                'QUEUED',
                'SCHEDULED'
              )

              AND j.available_at <= now()

              AND (
                SELECT count(*)

                FROM job_executions e

                WHERE e.job_id = j.id

                AND e.status IN(
                  'CLAIMED',
                  'RUNNING'
                )
              ) = 0

              ORDER BY
                j.priority DESC,
                j.available_at ASC,
                j.created_at ASC

              LIMIT 1

              FOR UPDATE OF j
              SKIP LOCKED
            )

            UPDATE jobs j

            SET status = 'CLAIMED'

            FROM candidate c

            WHERE j.id = c.id

            RETURNING j.*
            `,
            [queueId]
          )
        ).rows[0];

      if (!candidate) {
        return null;
      }

      const attempt =
        (
          await client.query(
            `
            SELECT
              COALESCE(
                max(attempt_no),
                0
              ) + 1 attempt_no

            FROM job_executions

            WHERE job_id = $1
            `,
            [candidate.id]
          )
        ).rows[0]
          .attempt_no;

      const execution =
        (
          await client.query(
            `
            INSERT INTO job_executions(
              job_id,
              worker_id,
              attempt_no,
              status
            )
            VALUES(
              $1,
              $2,
              $3,
              'CLAIMED'
            )

            RETURNING
              id,
              attempt_no
            `,
            [
              candidate.id,
              workerId,
              attempt
            ]
          )
        ).rows[0];

      return {
        ...candidate,
        executionId:
          execution.id,
        attemptNo:
          execution.attempt_no
      };
    }
  );
}

async function writeLog(
  executionId,
  level,
  message
) {
  await query(
    `
    INSERT INTO job_logs(
      execution_id,
      level,
      message
    )
    VALUES($1,$2,$3)
    `,
    [
      executionId,
      level,
      message
    ]
  );
}

async function execute(job) {
  active++;

  await heartbeat();

  const lockKey =
    `job-lock:${job.id}`;

  const lock =
    await redis.set(
      lockKey,
      workerId,
      {
        NX: true,
        EX: 120
      }
    );

  if (!lock) {
    active--;
    return;
  }

  try {
    await query(
      `
      UPDATE job_executions

      SET
        status = 'RUNNING',
        started_at = now()

      WHERE id = $1
      `,
      [job.executionId]
    );

    await query(
      `
      UPDATE jobs

      SET status = 'RUNNING'

      WHERE id = $1
      `,
      [job.id]
    );

    await writeLog(
      job.executionId,
      'INFO',
      `Worker ${workerId} started attempt ${job.attemptNo}`
    );

    try {
      const result =
        await executePayload(
          job.payload,
          {
            log:
              (
                level,
                message
              ) =>
                writeLog(
                  job.executionId,
                  level,
                  message
                )
          }
        );

      await transaction(
        async client => {
          await client.query(
            `
            UPDATE job_executions

            SET
              status = 'COMPLETED',
              finished_at = now()

            WHERE id = $1
            `,
            [job.executionId]
          );

          await client.query(
            `
            UPDATE jobs

            SET
              status = 'COMPLETED',
              completed_at = now()

            WHERE id = $1
            `,
            [job.id]
          );

          await client.query(
            `
            INSERT INTO job_logs(
              execution_id,
              level,
              message
            )
            VALUES(
              $1,
              'INFO',
              $2
            )
            `,
            [
              job.executionId,
              `Completed: ${JSON.stringify(result)}`
            ]
          );
        }
      );
    } catch (error) {
      await handleFailure(
        job,
        error
      );
    }
  } finally {
    await redis
      .del(lockKey)
      .catch(() => {});

    active--;

    await heartbeat()
      .catch(() => {});
  }
}

async function handleFailure(
  job,
  error
) {
  const policy =
    (
      await query(
        `
        SELECT rp.*

        FROM queues q

        LEFT JOIN retry_policies rp
          ON rp.id =
             q.retry_policy_id

        WHERE q.id = $1
        `,
        [job.queue_id]
      )
    ).rows[0];

  const maxAttempts =
    policy?.max_attempts || 3;

  const strategy =
    policy?.backoff_strategy ||
    'exponential';

  const base =
    policy?.base_delay_ms ||
    1000;

  const maxDelay =
    policy?.max_delay_ms ||
    60000;

  const jitter =
    policy?.jitter ??
    true;

  if (
    job.attemptNo >=
    maxAttempts
  ) {
    await transaction(
      async client => {
        await client.query(
          `
          UPDATE job_executions

          SET
            status = 'FAILED',
            finished_at = now(),
            error_code =
              'MAX_RETRIES',
            error_message = $2

          WHERE id = $1
          `,
          [
            job.executionId,
            error.message
          ]
        );

        await client.query(
          `
          UPDATE jobs

          SET
            status = 'FAILED',
            completed_at = now()

          WHERE id = $1
          `,
          [job.id]
        );

        await client.query(
          `
          INSERT INTO dead_letter_entries(
            job_id,
            execution_id,
            queue_id,
            reason,
            payload
          )
          VALUES(
            $1,
            $2,
            $3,
            $4,
            $5
          )
          `,
          [
            job.id,
            job.executionId,
            job.queue_id,
            'MAX_RETRIES_EXHAUSTED',
            job.payload
          ]
        );

        await client.query(
          `
          INSERT INTO job_logs(
            execution_id,
            level,
            message
          )
          VALUES(
            $1,
            'ERROR',
            $2
          )
          `,
          [
            job.executionId,
            `Moved to DLQ: ${error.message}`
          ]
        );
      }
    );

    return;
  }

  const delay =
    calculateRetryDelay(
      {
        backoff_strategy:
          strategy,

        base_delay_ms:
          base,

        max_delay_ms:
          maxDelay,

        jitter
      },
      job.attemptNo
    );

  await transaction(
    async client => {
      await client.query(
        `
        UPDATE job_executions

        SET
          status = 'RETRYING',
          finished_at = now(),
          error_code =
            'EXECUTION_FAILED',
          error_message = $2

        WHERE id = $1
        `,
        [
          job.executionId,
          error.message
        ]
      );

      await client.query(
        `
        UPDATE jobs

        SET
          status = 'SCHEDULED',
          available_at =
            now() +
            (
              $2 *
              interval '1 millisecond'
            )

        WHERE id = $1
        `,
        [
          job.id,
          delay
        ]
      );

      await client.query(
        `
        INSERT INTO job_logs(
          execution_id,
          level,
          message
        )
        VALUES(
          $1,
          'WARN',
          $2
        )
        `,
        [
          job.executionId,
          `Retry scheduled in ${delay}ms`
        ]
      );
    }
  );
}

async function poll() {
  if (shuttingDown) {
    return;
  }

  while (
    active < capacity
  ) {
    const job =
      await claimJob();

    if (!job) {
      break;
    }

    execute(job)
      .catch(error =>
        log(
          'ERROR',
          'worker execution crashed',
          {
            jobId: job.id,
            error:
              error.message
          }
        )
      );
  }
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  clearInterval(timer);

  log(
    'INFO',
    'Worker draining',
    {
      workerId,
      signal
    }
  );

  await heartbeat()
    .catch(() => {});

  const start =
    Date.now();

  while (
    active > 0 &&
    Date.now() - start <
      30000
  ) {
    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          250
        )
    );
  }

  await query(
    `
    UPDATE workers

    SET
      status = 'STOPPED',
      last_seen_at = now()

    WHERE id = $1
    `,
    [workerId]
  ).catch(() => {});

  await pool.end();

  await redis.quit();

  process.exit(0);
}

await connectRedis();

await register();

timer =
  setInterval(
    () =>
      poll().catch(error =>
        log(
          'ERROR',
          'poll failed',
          {
            error:
              error.message
          }
        )
      ),
    config.workerPollMs
  );

setInterval(
  () =>
    heartbeat()
      .catch(() => {}),
  config.workerHeartbeatMs
);

process.on(
  'SIGINT',
  () =>
    shutdown('SIGINT')
);

process.on(
  'SIGTERM',
  () =>
    shutdown('SIGTERM')
);

await poll();