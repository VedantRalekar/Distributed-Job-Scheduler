import test from 'node:test';
import assert from 'node:assert/strict';

import { executePayload } from '../worker/executor.js';

function logger() {
  const entries = [];

  return {
    entries,
    log: async (level, message) => entries.push({ level, message })
  };
}

test('executes echo jobs and records their message', async () => {
  const output = logger();

  const result = await executePayload(
    { type: 'echo', message: 'hello worker' },
    output
  );

  assert.deepEqual(result, { result: 'hello worker' });
  assert.deepEqual(output.entries, [
    { level: 'INFO', message: 'hello worker' }
  ]);
});

test('sums numeric input and rejects invalid sums', async () => {
  const output = logger();

  assert.deepEqual(
    await executePayload({ type: 'sum', values: [2, '3', 4] }, output),
    { result: 9 }
  );
  await assert.rejects(
    executePayload({ type: 'sum', values: [] }, output),
    /sum requires numeric values/
  );
});

test('fails intentional and unsupported jobs', async () => {
  const output = logger();

  await assert.rejects(
    executePayload({ type: 'fail', message: 'expected failure' }, output),
    /expected failure/
  );
  assert.deepEqual(output.entries, [
    { level: 'ERROR', message: 'expected failure' }
  ]);
  await assert.rejects(
    executePayload({ type: 'webhook' }, output),
    /Unsupported job type: webhook/
  );
});
