import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmark } from '../src/workloads.js';

test('workload benchmark exposes legacy units/ms and Batch units/s explicitly', () => {
  const result = benchmark();
  assert.equal(result.workload, 'monte-carlo-v1');
  assert.ok(result.durationMs > 0);
  assert.equal(result.rate, result.samples / result.durationMs);
  const expectedPerSecond = result.samples * 1_000 / result.durationMs;
  assert.ok(Math.abs(result.unitsPerSecond - expectedPerSecond) <= expectedPerSecond * Number.EPSILON * 2);
});
