import test from 'node:test';
import assert from 'node:assert/strict';
import { updateRateEstimate } from '../src/batch-worker.js';

test('worker capacity estimate adapts smoothly to changing task time', () => {
  assert.equal(updateRateEstimate(100, 100, 500, 0.5), 150);
  assert.throws(() => updateRateEstimate(100, 100, 0), /Invalid/);
});
