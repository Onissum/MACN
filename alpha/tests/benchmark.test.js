import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmark } from '../src/workloads.js';

test('workload benchmark exposes both legacy units per millisecond and Batch units per second', () => {
  const result = benchmark();
  assert.equal(result.workload, 'monte-carlo-v1');
  assert.ok(result.durationMs > 0);
  assert.equal(result.rate, result.samples / result.durationMs);
  assert.equal(result.unitsPerSecond, result.samples * 1_000 / result.durationMs);
  assert.ok(result.rate > 0);
});
