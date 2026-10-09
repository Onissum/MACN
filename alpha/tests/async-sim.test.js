import test from 'node:test';
import assert from 'node:assert/strict';
import { runAsyncSimulation } from '../lab/async-sim.js';

test('heterogeneous asynchronous workers finish independently and merge the exact baseline', () => {
  const result = runAsyncSimulation();
  assert.equal(result.resultVerified, true);
  assert.equal(result.completedTasks, 60);
  assert.ok(result.speedupVsFastestNode > 1);
  assert.deepEqual(result.nodes.map(node => node.id), ['desktop', 'laptop', 'old-pc']);
  assert.ok(result.nodes.every(node => node.unitsAccepted > 0));
  assert.ok(result.nodes[0].unitsAccepted > result.nodes[2].unitsAccepted);
});

test('a disconnected worker lease expires and its work is reassigned without losing results', () => {
  const result = runAsyncSimulation({ samples: 10_000, chunkSize: 100, pollMs: 50, leaseMs: 1_000,
    leaseSafetyMarginMs: 1_000, workers: [
      { id: 'desktop', unitsPerSecond: 10_000, targetSeconds: 1 },
      { id: 'laptop', unitsPerSecond: 5_000, targetSeconds: 1 },
      { id: 'old-pc', unitsPerSecond: 100, targetSeconds: 1, offlineAtMs: 100, offlineForMs: 10_000 }
    ] });
  assert.equal(result.resultVerified, true);
  assert.equal(result.completedTasks, 100);
  assert.equal(result.reassignments, 1);
  assert.ok(result.elapsedVirtualMs >= 3_000);
  assert.equal(result.nodes[2].tasksAccepted, 0);
});
