# Distributed Job Scheduling Platform

A production-inspired distributed job scheduling platform designed to reliably execute asynchronous background jobs across multiple worker processes. The system focuses on backend engineering fundamentals such as concurrency, database consistency, reliability, fault tolerance, API design, and full-stack implementation rather than simply maximizing the number of features.

The platform allows users to create and manage projects, configure independent job queues, schedule different types of jobs, and monitor distributed workers through a web dashboard. Jobs are persisted in the database and progress through a controlled lifecycle from Queued → Scheduled → Claimed → Running → Completed, with retry handling and Dead Letter Queue support for permanent failures.

The system is designed around multiple workers that independently poll queues, atomically claim jobs to prevent duplicate execution, execute jobs concurrently according to queue limits, maintain worker heartbeats, and gracefully shut down without losing active work.
## Quick start

Prerequisites: Node.js 20+ and Docker Desktop (or separately running PostgreSQL 17 and Redis 8).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start PostgreSQL and Redis:

   ```bash
   docker compose up -d
   ```

3. Create `.env` from the following values. Do not commit it.

   ```dotenv
   PORT=3000
   DATABASE_URL=postgresql://scheduler:scheduler@localhost:5432/job_scheduler
   REDIS_URL=redis://localhost:6379
   JWT_SECRET=replace-with-a-long-random-secret
   JWT_EXPIRES_IN=1d
   CORS_ORIGIN=http://localhost:3000
   RATE_LIMIT_PER_MINUTE=120
   WORKER_CAPACITY=5
   WORKER_POLL_MS=1000
   WORKER_HEARTBEAT_MS=5000
   SCHEDULER_POLL_MS=5000
   ```

4. Create the schema:

   ```bash
   npm run db:init
   ```

5. Start the API, then start a worker in another terminal. `WORKER_QUEUE_ID` must be the UUID of a queue created through the API.

   ```bash
   npm run dev
   $env:WORKER_QUEUE_ID = 'your-queue-uuid'; npm run worker
   ```

Open `http://localhost:3000/api/health` to verify the API. The bundled dashboard is served from `/`.

Run the unit tests with:

```bash
npm test
```

## Architecture

## API documentation
### Register
POST /api/auth/register
```
{
  "email": "admin@example.com",
  "password": "password123",
  "displayName": "Admin",
  "organizationName": "Demo Org"
}
```

### Create project
POST /api/projects
```
{
  "organizationId": "<ORG_ID>",
  "name": "Demo Project"
}
```
### Create retry policy
POST /api/projects/<PROJECT_ID>/retry-policies
```
{
  "name": "Exponential Retry",
  "maxAttempts": 3,
  "backoffStrategy": "exponential",
  "baseDelayMs": 1000,
  "maxDelayMs": 30000,
  "jitter": true
}
```
### Create queue
POST /api/queues
```
{
  "projectId": "<PROJECT_ID>",
  "name": "default",
  "concurrencyLimit": 5,
  "retryPolicyId": "<RETRY_POLICY_ID>"
}
```
Start worker
Set:
```
WORKER_QUEUE_ID=<QUEUE_ID>
WORKER_CAPACITY=5
```
Then:
```
npm run worker
```
Multiple worker processes can be started against the same queue.

### Immediate job
POST /api/jobs
```
{
  "queueId": "<QUEUE_ID>",
  "priority": 10,
  "payload": {
    "type": "echo",
    "message": "hello distributed workers"
  }
}
```
### Delayed job
```
{
  "queueId": "<QUEUE_ID>",
  "priority": 5,
  "delayMs": 10000,
  "payload": {
    "type": "sleep",
    "ms": 1000
  }
}
```
### Scheduled job
```
{
  "queueId": "<QUEUE_ID>",
  "scheduledAt": "2026-08-23T04:00:00.000Z",
  "payload": {
    "type": "echo",
    "message": "scheduled"
  }
}
```
### Batch jobs
POST /api/jobs/batch
```
{
  "queueId": "<QUEUE_ID>",
  "jobs": [
    {
      "priority": 10,
      "payload": {
        "type": "echo",
        "message": "one"
      }
    },
    {
      "priority": 5,
      "payload": {
        "type": "echo",
        "message": "two"
      }
    }
  ]
}
```
### Recurring jobs
POST /api/schedules
```
{
  "queueId": "<QUEUE_ID>",
  "cronExpr": "*/5 * * * *",
  "timezone": "UTC",
  "nextRunAt": "2026-08-23T04:05:00.000Z",
  "payload": {
    "type": "echo",
    "message": "recurring"
  }
}
```
### Worker handlers
Supported demo payloads:
```
{
  "type": "echo",
  "message": "hello"
}
```
```
{
  "type": "sleep",
  "ms": 2000
}
```
```
{
  "type": "sum",
  "values": [10, 20, 30]
}
```
```
{
  "type": "fail",
  "message": "simulate failure"
}
```
All API routes return `{ "success": true, "data": ... }` on success. Protected routes require `Authorization: Bearer <token>`. 
Typical workflow:
1. `POST /api/auth/register` creates a user, organization, and JWT.
2. `POST /api/projects` and `POST /api/queues` create a destination for work.
3. Start a worker with that queue UUID and use `POST /api/jobs` to enqueue payloads.

Supported worker payloads are `echo`, `sum`, `sleep` (capped at 30 seconds), and `fail`. This executor is intentionally a safe demonstration surface; it does not run arbitrary commands.

## Test coverage

The tests use Node's built-in test runner and need no running services. They cover retry backoff strategies and caps, jitter bounds, and worker payload execution success/failure behavior. Database-backed integration tests are deliberately not included yet; see the testing follow-up in the design document.
