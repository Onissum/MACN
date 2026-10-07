import test from 'node:test';
import assert from 'node:assert/strict';
import { realRun } from '../lab/real.js';
test('real laboratory threads compute and recover a dropped result over WebSockets', { timeout: 20000 }, async () => {
  const result = await realRun({ nodes: 3, samples: 10000000, scenario: 'churn', deadlineMs: 15000 });
  assert.equal(result.verified, true); assert.equal(result.injectedDroppedResults, 1);
  assert.ok(result.retries >= 1); assert.ok(result.protocolMessages > 0);
  assert.equal(result.kind, 'real-local-worker-threads-and-websockets');
});
