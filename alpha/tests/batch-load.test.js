import test from 'node:test';
import assert from 'node:assert/strict';
import { runBatchLoad } from '../lab/batch-load.js';

test('Batch virtual load probe returns valid deterministic workload results through trusted verification', () => {
  const report = runBatchLoad({ nodes: 3, tasks: 5 });
  assert.equal(report.completed, 5);
  assert.equal(report.taskCount, 5);
  assert.match(report.caveat, /coordinator verification is included/);
});
