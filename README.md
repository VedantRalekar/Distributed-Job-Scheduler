# Distributed Job Scheduler

A multi-tenant job scheduling service built with Node.js, Express, PostgreSQL, and Redis. It lets authenticated organization members create projects and queues, enqueue immediate or delayed work, operate workers, schedule recurring jobs, and inspect executions or dead-lettered work.

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

```mermaid
flowchart LR
  U[Dashboard / API client] -->|JWT HTTP| A[Express API]
  A --> PG[(PostgreSQL)]
  A --> R[(Redis)]
  S[Scheduler process\ncron-parser] -->|materializes due schedules| PG
  W[Worker process] -->|atomically claims jobs| PG
  W -->|distributed job lock| R
  W -->|heartbeats, executions, logs| PG
  A -->|metrics / status| U
```

The API process hosts the recurring-job scheduler. Workers are separate Node processes and are horizontally scalable; each worker is assigned one queue using `WORKER_QUEUE_ID`.

## Data model

```mermaid
erDiagram
  ORGANIZATIONS ||--o{ ORGANIZATION_MEMBERS : has
  USERS ||--o{ ORGANIZATION_MEMBERS : joins
  ORGANIZATIONS ||--o{ PROJECTS : owns
  PROJECTS ||--o{ RETRY_POLICIES : defines
  PROJECTS ||--o{ QUEUES : contains
  RETRY_POLICIES o|--o{ QUEUES : configures
  QUEUES ||--o{ JOBS : receives
  QUEUES ||--o{ SCHEDULED_JOBS : schedules
  RETRY_POLICIES o|--o{ SCHEDULED_JOBS : configures
  QUEUES ||--o{ WORKERS : serves
  JOBS ||--o{ JOB_EXECUTIONS : attempts
  WORKERS o|--o{ JOB_EXECUTIONS : performs
  WORKERS ||--|| WORKER_HEARTBEATS : reports
  JOB_EXECUTIONS ||--o{ JOB_LOGS : emits
  JOBS ||--o{ DEAD_LETTER_ENTRIES : may_create
  JOB_EXECUTIONS o|--o{ DEAD_LETTER_ENTRIES : records
```

`jobs.status` moves through `QUEUED`/`SCHEDULED` → `CLAIMED` → `RUNNING` → `COMPLETED`, or returns to `SCHEDULED` for a retry. Exhausted attempts become `FAILED` and create a dead-letter entry.

## API documentation

All API routes return `{ "success": true, "data": ... }` on success. Protected routes require `Authorization: Bearer <token>`. See [the complete endpoint reference](docs/API.md), including request bodies and response shapes.

Typical workflow:

1. `POST /api/auth/register` creates a user, organization, and JWT.
2. `POST /api/projects` and `POST /api/queues` create a destination for work.
3. Start a worker with that queue UUID and use `POST /api/jobs` to enqueue payloads.

Supported worker payloads are `echo`, `sum`, `sleep` (capped at 30 seconds), and `fail`. This executor is intentionally a safe demonstration surface; it does not run arbitrary commands.

## Design decisions

The major reliability and scalability decisions, plus their trade-offs and current limitations, are recorded in [docs/DESIGN_DECISIONS.md](docs/DESIGN_DECISIONS.md).

## Test coverage

The tests use Node's built-in test runner and need no running services. They cover retry backoff strategies and caps, jitter bounds, and worker payload execution success/failure behavior. Database-backed integration tests are deliberately not included yet; see the testing follow-up in the design document.
