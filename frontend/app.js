const state = {
  token:
    localStorage.getItem(
      'token'
    ),

  projects: [],

  queues: []
};

const $ = id =>
  document.getElementById(id);

const api = async (
  path,
  options = {}
) => {
  const response =
    await fetch(
      '/api' + path,
      {
        ...options,

        headers: {
          'Content-Type':
            'application/json',

          Authorization:
            `Bearer ${state.token}`,

          ...(options.headers || {})
        }
      }
    );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error?.message ||
      'Request failed'
    );
  }

  return data.data;
};

const toast = message => {
  $('toast').textContent =
    message;

  $('toast').style.display =
    'block';

  setTimeout(
    () =>
      $('toast').style.display =
        'none',
    2500
  );
};

function showDashboard() {
  $('loginView')
    .classList
    .toggle(
      'hidden',
      !!state.token
    );

  $('dashboardView')
    .classList
    .toggle(
      'hidden',
      !state.token
    );
}

$('loginForm').addEventListener(
  'submit',
  async event => {
    event.preventDefault();

    try {
      const response =
        await fetch(
          '/api/auth/login',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json'
            },

            body: JSON.stringify({
              email:
                $('email').value,

              password:
                $('password').value
            })
          }
        );

      const data =
        await response.json();

      if (!data.success) {
        throw new Error(
          data.error?.message ||
          'Login failed'
        );
      }

      state.token =
        data.data.token;

      localStorage.setItem(
        'token',
        state.token
      );

      showDashboard();

      await loadAll();
    } catch (error) {
      $('loginMessage')
        .textContent =
        error.message;
    }
  }
);

$('logoutBtn').onclick =
  () => {
    localStorage.removeItem(
      'token'
    );

    state.token = null;

    showDashboard();
  };

$('projectForm').onsubmit =
  async event => {
    event.preventDefault();

    try {
      const decoded =
        JSON.parse(
          atob(
            state.token.split('.')[1]
          )
        );

      await api(
        '/projects',
        {
          method: 'POST',

          body: JSON.stringify({
            organizationId:
              decoded.organizationId,

            name:
              $('projectName')
                .value
          })
        }
      );

      $('projectName')
        .value = '';

      toast(
        'Project created'
      );

      await loadAll();
    } catch (error) {
      toast(
        error.message
      );
    }
  };

$('queueForm').onsubmit =
  async event => {
    event.preventDefault();

    try {
      await api(
        '/queues',
        {
          method: 'POST',

          body: JSON.stringify({
            projectId:
              $('queueProject')
                .value,

            name:
              $('queueName')
                .value,

            concurrencyLimit:
              Number(
                $('queueConcurrency')
                  .value
              ),

            retryPolicyId:
              $('queueRetryPolicy')
                .value ||
              null
          })
        }
      );

      toast(
        'Queue created'
      );

      event.target.reset();

      await loadAll();
    } catch (error) {
      toast(
        error.message
      );
    }
  };

$('jobForm').onsubmit =
  async event => {
    event.preventDefault();

    try {
      await api(
        '/jobs',
        {
          method: 'POST',

          body: JSON.stringify({
            queueId:
              $('jobQueue')
                .value,

            priority:
              Number(
                $('jobPriority')
                  .value
              ),

            delayMs:
              Number(
                $('jobDelay')
                  .value
              ),

            dedupeKey:
              $('jobDedupe')
                .value ||
              undefined,

            payload:
              JSON.parse(
                $('jobPayload')
                  .value
              )
          })
        }
      );

      toast(
        'Job created'
      );

      await loadJobs();

      await loadMetrics();
    } catch (error) {
      toast(
        error.message
      );
    }
  };

$('scheduleForm').onsubmit =
  async event => {
    event.preventDefault();

    try {
      const next =
        new Date(
          $('nextRunAt')
            .value
        ).toISOString();

      await api(
        '/schedules',
        {
          method: 'POST',

          body: JSON.stringify({
            queueId:
              $('scheduleQueue')
                .value,

            cronExpr:
              $('cronExpr')
                .value,

            timezone:
              $('timezone')
                .value,

            nextRunAt:
              next,

            payload:
              JSON.parse(
                $('schedulePayload')
                  .value
              )
          })
        }
      );

      toast(
        'Recurring schedule created'
      );
    } catch (error) {
      toast(
        error.message
      );
    }
  };

async function loadAll() {
  if (!state.token) {
    return;
  }

  try {
    const decoded =
      JSON.parse(
        atob(
          state.token.split('.')[1]
        )
      );

    state.projects =
      await api(
        `/projects/${decoded.organizationId}`
      );

    $('projects').innerHTML =
      state.projects
        .map(
          project =>
            `
            <div class="badge">
              ${project.name}
              ·
              ${project.id.slice(0, 8)}
            </div>
            `
        )
        .join(' ') ||
      '<span class="muted">No projects</span>';

    $('queueProject')
      .innerHTML =
      state.projects
        .map(
          project =>
            `
            <option value="${project.id}">
              ${project.name}
            </option>
            `
        )
        .join('');

    const all = [];

    for (
      const project
      of state.projects
    ) {
      all.push(
        ...await api(
          `/queues/project/${project.id}`
        )
      );
    }

    state.queues = all;

    const options =
      all
        .map(
          queue =>
            `
            <option value="${queue.id}">
              ${queue.name}
            </option>
            `
        )
        .join('');

    $('jobQueue')
      .innerHTML = options;

    $('scheduleQueue')
      .innerHTML = options;

    $('filterQueue')
      .innerHTML = options;

    renderQueues();

    await loadMetrics();

    await loadJobs();

    await loadWorkers();

    await loadDlq();

  } catch (error) {
    if (
      error.message.includes(
        'token'
      ) ||
      error.message.includes(
        'Authentication'
      )
    ) {
      localStorage.removeItem(
        'token'
      );

      state.token = null;

      showDashboard();
    } else {
      toast(
        error.message
      );
    }
  }
}

function renderQueues() {
  $('queues')
    .innerHTML =
    `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Concurrency</th>
          <th>State</th>
          <th>Total</th>
          <th>Active</th>
          <th>Completed</th>
          <th>Failed</th>
          <th>Action</th>
        </tr>
      </thead>

      <tbody>

        ${
          state.queues
            .map(
              queue =>
                `
                <tr>

                  <td>
                    ${queue.name}
                  </td>

                  <td>
                    ${queue.concurrency_limit}
                  </td>

                  <td>
                    <span class="badge">
                      ${
                        queue.paused
                          ? 'PAUSED'
                          : 'RUNNING'
                      }
                    </span>
                  </td>

                  <td>
                    ${queue.total_jobs}
                  </td>

                  <td>
                    ${queue.active_jobs}
                  </td>

                  <td>
                    ${queue.completed_jobs}
                  </td>

                  <td>
                    ${queue.failed_jobs}
                  </td>

                  <td>
                    <button
                      class="small"
                      onclick="toggleQueue(
                        '${queue.id}',
                        ${queue.paused}
                      )"
                    >
                      ${
                        queue.paused
                          ? 'Resume'
                          : 'Pause'
                      }
                    </button>
                  </td>

                </tr>
                `
            )
            .join('')
        }

      </tbody>
    </table>
    `;
}

async function toggleQueue(
  id,
  paused
) {
  try {
    await api(
      `/queues/${id}/${
        paused
          ? 'resume'
          : 'pause'
      }`,
      {
        method: 'POST'
      }
    );

    await loadAll();

  } catch (error) {
    toast(
      error.message
    );
  }
}

async function loadMetrics() {
  const metrics =
    await api(
      '/metrics'
    );

  const statuses = [
    'QUEUED',
    'RUNNING',
    'COMPLETED',
    'FAILED'
  ];

  $('stats').innerHTML =
    statuses
      .map(
        status =>
          `
          <div class="stat">

            <span class="muted">
              ${status}
            </span>

            <b>
              ${
                metrics.jobs[
                  status
                ] || 0
              }
            </b>

          </div>
          `
      )
      .join('') +

    `
    <div class="stat">

      <span class="muted">
        Live workers
      </span>

      <b>
        ${metrics.activeWorkers}
      </b>

    </div>
    `;
}

async function loadJobs() {
  const queue =
    $('filterQueue')
      .value;

  if (!queue) {
    $('jobs').innerHTML =
      `
      <span class="muted">
        Create a queue first.
      </span>
      `;

    return;
  }

  const status =
    $('filterStatus')
      .value;

  const jobs =
    await api(
      `/jobs?queueId=${queue}` +
      (
        status
          ? `&status=${status}`
          : ''
      ) +
      '&limit=100'
    );

  $('jobs')
    .innerHTML =
    `
    <table>

      <thead>

        <tr>
          <th>ID</th>
          <th>Priority</th>
          <th>Status</th>
          <th>Available</th>
          <th>Created</th>
          <th>Attempts</th>
        </tr>

      </thead>

      <tbody>

        ${
          jobs
            .map(
              job =>
                `
                <tr
                  onclick="inspectJob(
                    '${job.id}'
                  )"
                >

                  <td>
                    ${job.id.slice(0, 8)}
                  </td>

                  <td>
                    ${job.priority}
                  </td>

                  <td>
                    <span class="badge">
                      ${job.status}
                    </span>
                  </td>

                  <td>
                    ${
                      new Date(
                        job.available_at
                      ).toLocaleString()
                    }
                  </td>

                  <td>
                    ${
                      new Date(
                        job.created_at
                      ).toLocaleString()
                    }
                  </td>

                  <td>
                    ${job.attempts}
                  </td>

                </tr>
                `
            )
            .join('')
        }

      </tbody>

    </table>
    `;
}

async function inspectJob(id) {
  try {
    const [
      job,
      logs
    ] =
      await Promise.all([
        api(`/jobs/${id}`),
        api(`/jobs/${id}/logs`)
      ]);

    $('jobDetails')
      .textContent =
      JSON.stringify(
        {
          job,
          logs
        },
        null,
        2
      );

  } catch (error) {
    toast(
      error.message
    );
  }
}

async function loadWorkers() {
  const workers =
    await api(
      '/workers'
    );

  $('workers')
    .innerHTML =
    `
    <table>

      <thead>

        <tr>
          <th>Host</th>
          <th>Queue</th>
          <th>Status</th>
          <th>Load</th>
          <th>Active</th>
          <th>Heartbeat</th>
        </tr>

      </thead>

      <tbody>

        ${
          workers
            .map(
              worker =>
                `
                <tr>

                  <td>
                    ${worker.hostname}
                  </td>

                  <td>
                    ${worker.queue_name}
                  </td>

                  <td>
                    ${worker.status}
                  </td>

                  <td>
                    ${
                      worker.load_pct ||
                      0
                    }%
                  </td>

                  <td>
                    ${
                      worker.active_executions ||
                      0
                    }
                  </td>

                  <td>
                    ${
                      worker.heartbeat_at
                        ? new Date(
                            worker.heartbeat_at
                          )
                            .toLocaleTimeString()
                        : '-'
                    }
                  </td>

                </tr>
                `
            )
            .join('')
        }

      </tbody>

    </table>
    `;
}

async function loadDlq() {
  const entries =
    await api(
      '/dlq'
    );

  $('dlq')
    .innerHTML =
    `
    <table>

      <thead>

        <tr>
          <th>Queue</th>
          <th>Reason</th>
          <th>Failed</th>
          <th>Action</th>
        </tr>

      </thead>

      <tbody>

        ${
          entries
            .map(
              entry =>
                `
                <tr>

                  <td>
                    ${entry.queue_name}
                  </td>

                  <td>
                    ${entry.reason}
                  </td>

                  <td>
                    ${
                      new Date(
                        entry.failed_at
                      ).toLocaleString()
                    }
                  </td>

                  <td>

                    <button
                      class="small danger"
                      onclick="requeue(
                        '${entry.id}'
                      )"
                    >
                      Requeue
                    </button>

                  </td>

                </tr>
                `
            )
            .join('')
        }

      </tbody>

    </table>
    `;
}

async function requeue(id) {
  try {
    await api(
      `/dlq/${id}/requeue`,
      {
        method: 'POST'
      }
    );

    toast(
      'Requeued'
    );

    await loadAll();

  } catch (error) {
    toast(
      error.message
    );
  }
}

setInterval(
  () =>
    state.token &&
    loadAll(),
  10000
);

showDashboard();

if (state.token) {
  loadAll();
}