import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../lab/simulate.js';
import { breakEvenRun } from '../lab/break-even.js';

test('modeled data movement increases job time without changing the local baseline', () => {
  const computeOnly = simulate({ nodes: 4, samples: 200000, seed: 9, dataBytesPerUnit: 0, computeMultiplier: 1 });
  const dataHeavy = simulate({ nodes: 4, samples: 200000, seed: 9, dataBytesPerUnit: 64, computeMultiplier: 1 });
  assert.equal(computeOnly.verified, true);
  assert.equal(dataHeavy.verified, true);
  assert.ok(dataHeavy.modelledMs > computeOnly.modelledMs);
  assert.equal(dataHeavy.singleNodeMs, computeOnly.singleNodeMs);
  assert.ok(dataHeavy.inputBytesSent > computeOnly.inputBytesSent);
  assert.ok(dataHeavy.outputBytesSent > computeOnly.outputBytesSent);
});

test('break-even matrix compares policies on paired network profiles', () => {
  const result = breakEvenRun({ nodes: [1, 4], samples: 20000, seed: 3, repeats: 1,
    dataBytesPerUnit: [0, 64], computeMultipliers: [1], scenarios: ['steady'] });
  assert.equal(result.kind, 'simulated-break-even-matrix');
  assert.equal(result.summary.length, 4);
  assert.ok(result.summary.every(row => row.policies.adaptive.verified && row.policies.equal.verified && row.policies.calibrated.verified));
  assert.ok(result.runs.every(run => run.kind === 'discrete-event-simulation'));
  assert.ok(result.summary.every(row => row.breakEvenNodes === null || [1, 4].includes(row.breakEvenNodes)));
});

test('churn with no surviving node is reported as incomplete, not as a speedup', () => {
  const result = simulate({ nodes: 1, samples: 1000000, scenario: 'churn' });
  assert.equal(result.status, 'failed');
  assert.equal(result.verified, false);
  assert.equal(result.speedup, null);
  assert.match(result.error, /No simulated nodes remain/);

  const matrix = breakEvenRun({ nodes: [1], samples: 1000000, repeats: 1,
    dataBytesPerUnit: [0], computeMultipliers: [1], scenarios: ['churn'] });
  assert.equal(matrix.summary[0].policies.adaptive.verified, false);
  assert.equal(matrix.summary[0].policies.adaptive.medianSpeedup, null);
  assert.equal(matrix.summary[0].breakEvenNodes, null);
});
