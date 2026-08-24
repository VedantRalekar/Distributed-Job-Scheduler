CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT UNIQUE NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(40) NOT NULL CHECK (
    role IN ('ADMIN', 'OPERATOR', 'VIEWER')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retry_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  max_attempts INT NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  backoff_strategy VARCHAR(30) NOT NULL CHECK (
    backoff_strategy IN ('fixed', 'linear', 'exponential')
  ),
  base_delay_ms INT NOT NULL DEFAULT 1000 CHECK (base_delay_ms >= 0),
  max_delay_ms INT NOT NULL DEFAULT 60000 CHECK (
    max_delay_ms >= base_delay_ms
  ),
  jitter BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS queues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  concurrency_limit INT NOT NULL DEFAULT 5 CHECK (concurrency_limit > 0),
  retry_policy_id UUID REFERENCES retry_policies(id) ON DELETE SET NULL,
  paused BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  dedupe_key VARCHAR(200),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority SMALLINT NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL CHECK (
    status IN (
      'QUEUED',
      'SCHEDULED',
      'CLAIMED',
      'RUNNING',
      'COMPLETED',
      'FAILED'
    )
  ),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_queue_dedupe_idx
ON jobs(queue_id, dedupe_key)
WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_claim_idx
ON jobs(
  queue_id,
  status,
  available_at,
  priority DESC,
  created_at
);

CREATE INDEX IF NOT EXISTS jobs_status_idx
ON jobs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  retry_policy_id UUID REFERENCES retry_policies(id) ON DELETE SET NULL,
  cron_expr VARCHAR(120) NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  next_run_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_jobs_due_idx
ON scheduled_jobs(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  hostname VARCHAR(255) NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (
    status IN ('STARTING', 'RUNNING', 'DRAINING', 'STOPPED')
  ),
  capacity INT NOT NULL CHECK (capacity > 0),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workers_queue_status_idx
ON workers(queue_id, status);

CREATE TABLE IF NOT EXISTS job_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES workers(id) ON DELETE SET NULL,
  attempt_no INT NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (
    status IN (
      'CLAIMED',
      'RUNNING',
      'COMPLETED',
      'FAILED',
      'RETRYING'
    )
  ),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  error_code VARCHAR(80),
  error_message TEXT,
  UNIQUE(job_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS executions_job_idx
ON job_executions(job_id, attempt_no DESC);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id UUID PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  load_pct SMALLINT NOT NULL DEFAULT 0 CHECK (
    load_pct BETWEEN 0 AND 100
  ),
  active_executions INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS job_logs (
  id BIGSERIAL PRIMARY KEY,
  execution_id UUID NOT NULL REFERENCES job_executions(id) ON DELETE CASCADE,
  level VARCHAR(12) NOT NULL CHECK (
    level IN ('DEBUG', 'INFO', 'WARN', 'ERROR')
  ),
  message TEXT NOT NULL,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_logs_execution_idx
ON job_logs(execution_id, logged_at);

CREATE TABLE IF NOT EXISTS dead_letter_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  execution_id UUID REFERENCES job_executions(id) ON DELETE SET NULL,
  queue_id UUID NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  reason VARCHAR(120) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  requeued_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS dlq_queue_idx
ON dead_letter_entries(
  queue_id,
  requeued_at,
  failed_at DESC
);