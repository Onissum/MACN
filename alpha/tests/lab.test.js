import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicy, partition, policyNames } from '../src/policies.js';
import { simulate } from '../lab/simulate.js';
import { Events } from '../lab/events.js';
import { TaskEngine } from '../src/engine.js';
import { monteCarlo } from '../src/workloads.js';
test('fixed partitions have exact coverage and equal/calibrated weights', () => {
  const nodes = [{ id: 'a', initialRate: 1 }, { id: 'b', initialRate: 3 }];
  assert.deepEqual([...partition(nodes, 1000, () => 1).values()], [{ start: 0, end: 500 }, { start: 500, end: 1000 }]);
  assert.deepEqual([...createPolicy('calibrated').allocations(nodes, 1000).values()], [{ start: 0, end: 250 }, { start: 250, end: 1000 }]);
  assert.throws(() => createPolicy('typo'));
});
test('all policies preserve real Monte Carlo semantics', () => {
  for (const policy of policyNames) {
    const queue = []; let clock = 0;
    const engine = new TaskEngine({ scheduler: createPolicy(policy), now: () => clock, send: (id, event, data) => { if (event === 'task') queue.push({ id, ...data }); return true; } });
    for (const [id, rate] of [['a', 100], ['b', 300]]) engine.addNode(id, id, { workload: monteCarlo.id, rate });
    engine.start({ params: { samples: 100000, seed: 42 } });
    while (engine.job.status === 'running') { const m = queue.shift(); assert.ok(m); clock += 1; engine.accept(m.id, { jobId: m.jobId, taskId: m.task.id, attempt: m.task.attempt, result: monteCarlo.compute(m.task), computeMs: 1 }); }
    assert.equal(engine.job.result.hits, monteCarlo.compute({ start: 0, count: 100000, seed: 42 }).hits);
  }
});
test('simulation is deterministic and recovers fixed unissued ranges on loss', () => {
  for (const policy of policyNames) {
    const a = simulate({ nodes: 20, samples: 20000000, scenario: 'churn', policy });
    const b = simulate({ nodes: 20, samples: 20000000, scenario: 'churn', policy });
    assert.equal(a.verified, true); assert.equal(b.verified, true);
    assert.equal(a.modelledMs, b.modelledMs); assert.equal(a.taskCount, b.taskCount); assert.ok(a.retries > 0);
    assert.deepEqual(a.result, b.result);
  }
});
test('1000 simulated nodes finish with exact full coverage', () => {
  const result = simulate({ nodes: 1000, samples: 1000000000 });
  assert.equal(result.verified, true); assert.equal(result.contributors, 1000);
  assert.equal(result.kind, 'discrete-event-simulation');
});
test('10000-node simulation finishes correctly without quadratic idle scans', () => {
  const result = simulate({ nodes: 10000, samples: 1000000000, policy: 'adaptive' });
  assert.equal(result.verified, true); assert.equal(result.contributors, 10000);
  assert.equal(result.status, 'completed'); assert.ok(result.dispatchCalls > 10000);
  assert.ok(result.dispatchMs < result.wallMs);
});
test('slowdown comparison can measure adaptive improvement without timing the host', () => {
  const fixed = simulate({ nodes: 20, policy: 'calibrated', scenario: 'slowdown' });
  const adaptive = simulate({ nodes: 20, policy: 'adaptive', scenario: 'slowdown' });
  assert.ok(fixed.verified && adaptive.verified); assert.ok(adaptive.modelledMs < fixed.modelledMs);
});
test('heap orders by time and uses stable ties', () => {
  const heap = new Events(); heap.push(2, 'c'); heap.push(1, 'a'); heap.push(1, 'b');
  assert.deepEqual([heap.pop().fn, heap.pop().fn, heap.pop().fn], ['a', 'b', 'c']); assert.equal(heap.size, 0);
});
test('RTT-aware sizing avoids the small-task feedback loop at high latency', () => {
  const fixed = simulate({ nodes: 20, policy: 'calibrated', scenario: 'latency' });
  const adaptive = simulate({ nodes: 20, policy: 'adaptive', scenario: 'latency' });
  assert.ok(adaptive.verified); assert.ok(adaptive.modelledMs < fixed.modelledMs);
});
test('fractional calibration weights never leave a final unassigned unit', () => {
  const rates = [134.325, 97.315, 31.346, 17.125, 102.786, 99.916, 29.717];
  for (let offset = 0; offset < 50; offset++) {
    const nodes = rates.map((rate, i) => ({ id: String(i), rate: rate + offset / 17 }));
    const ranges = [...partition(nodes, 50000000, n => n.rate).values()];
    assert.equal(ranges.at(-1).end, 50000000);
    for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i].start, ranges[i - 1].end);
  }
});
test('simulated message accounting includes normal results and heartbeat replies', () => {
  const run = simulate({ nodes: 1, samples: 1000 });
  assert.equal(run.verified, true); assert.equal(run.taskCount, 1); assert.equal(run.protocolMessages, 4);
});
