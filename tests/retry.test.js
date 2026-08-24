import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateRetryDelay
} from '../src/utils/retry.js';

test(
  'fixed retry delay',
  () => {
    assert.equal(
      calculateRetryDelay(
        {
          backoff_strategy:
            'fixed',

          base_delay_ms:
            1000,

          max_delay_ms:
            10000,

          jitter: false
        },
        3
      ),
      1000
    );
  }
);

test(
  'linear retry delay',
  () => {
    assert.equal(
      calculateRetryDelay(
        {
          backoff_strategy:
            'linear',

          base_delay_ms:
            1000,

          max_delay_ms:
            10000,

          jitter: false
        },
        3
      ),
      3000
    );
  }
);

test(
  'exponential retry delay respects cap',
  () => {
    assert.equal(
      calculateRetryDelay(
        {
          backoff_strategy:
            'exponential',

          base_delay_ms:
            1000,

          max_delay_ms:
            5000,

          jitter: false
        },
        5
      ),
      5000
    );
  }
);

test(
  'jitter stays within 50-150 percent',
  () => {
    const policy = {
      backoff_strategy:
        'fixed',

      base_delay_ms:
        1000,

      max_delay_ms:
        5000,

      jitter: true
    };

    assert.equal(
      calculateRetryDelay(
        policy,
        1,
        () => 0
      ),
      500
    );

    assert.equal(
      calculateRetryDelay(
        policy,
        1,
        () => 1
      ),
      1500
    );
  }
);