import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityRun } from '../lab/capacity.js';

test('capacity probe connects real loopback workers and verifies one shared job', async () => {
  const result = await capacityRun({ nodes: 3, samples: 30000, seed: 17 });
  assert.equal(result.kind, 'real-loopback-websocket-control-plane');
  assert.equal(result.connected, 3);
  assert.equal(result.verified, true);
  assert.equal(result.status, 'completed');
  assert.equal(result.completedUnits, 30000);
  assert.ok(result.protocolMessages >= result.taskCount * 2);
  assert.ok(result.taskRoundTripMs.samples > 0);
  assert.ok(result.sampledPeakProcessRssBytes > 0);
});

test('capacity probe rejects unmeasured scale beyond its physical socket limit', async () => {
  await assert.rejects(() => capacityRun({ nodes: 2001 }), /1\.\.2000/);
});
