import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeComparison, compareRun } from '../lab/compare.js';

test('comparison summary uses paired seeds and reports setup-inclusive speedup separately', () => {
  const runs = [
    { repeat: 1, topology: 'sequential', nodes: 1, elapsedMs: 100, setupMs: 0, verified: true },
    { repeat: 2, topology: 'sequential', nodes: 1, elapsedMs: 200, setupMs: 0, verified: true },
    { repeat: 1, topology: 'macn-workers', nodes: 2, elapsedMs: 50, setupMs: 10, throughput: 2000, verified: true },
    { repeat: 2, topology: 'macn-workers', nodes: 2, elapsedMs: 100, setupMs: 20, throughput: 1000, verified: true }
  ];
  const [summary] = summarizeComparison(runs);
  assert.equal(summary.medianJobSpeedup, 2);
  assert.equal(summary.medianEndToEndSpeedup, 100 / 60);
  assert.equal(summary.medianEfficiency, 1);
  assert.equal(summary.medianJobMs, 75);
  assert.equal(summary.verified, true);
});

test('comparison runner rejects invalid worker counts before opening a listener', async () => {
  await assert.rejects(compareRun({ nodes: [0], samples: 1000 }), /unique integers from 1 to 50/);
  await assert.rejects(compareRun({ nodes: [2, 2], samples: 1000 }), /unique integers from 1 to 50/);
});
