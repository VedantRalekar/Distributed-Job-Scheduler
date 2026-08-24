import { CronExpressionParser } from 'cron-parser';

import {
  transaction
} from './db.js';

import {
  config
} from './config.js';

import {
  log
} from './utils/logger.js';

function nextCron(
  expression,
  timezone,
  from = new Date()
) {
  return CronExpressionParser
    .parse(
      expression,
      {
        currentDate: from,
        tz: timezone
      }
    )
    .next()
    .toDate();
}

async function processScheduledJobs() {
  await transaction(
    async client => {
      const due =
        (
          await client.query(
            `
            SELECT s.*

            FROM scheduled_jobs s

            WHERE s.enabled = true

            AND s.next_run_at <= now()

            ORDER BY s.next_run_at

            LIMIT 100

            FOR UPDATE SKIP LOCKED
            `
          )
        ).rows;

      for (const item of due) {
        await client.query(
          `
          INSERT INTO jobs(
            queue_id,
            payload,
            priority,
            status,
            available_at
          )
          VALUES(
            $1,
            $2,
            0,
            'QUEUED',
            now()
          )
          `,
          [
            item.queue_id,
            item.payload
          ]
        );

        const next =
          nextCron(
            item.cron_expr,
            item.timezone,
            new Date()
          );

        await client.query(
          `
          UPDATE scheduled_jobs
          SET next_run_at = $1
          WHERE id = $2
          `,
          [
            next,
            item.id
          ]
        );
      }
    }
  );
}

export function startScheduler() {
  const timer =
    setInterval(
      () => {
        processScheduledJobs()
          .catch(error =>
            log(
              'ERROR',
              'scheduler error',
              {
                error:
                  error.message
              }
            )
          );
      },
      config.schedulerPollMs
    );

  processScheduledJobs()
    .catch(error =>
      log(
        'ERROR',
        'initial scheduler error',
        {
          error:
            error.message
        }
      )
    );

  return () =>
    clearInterval(timer);
}