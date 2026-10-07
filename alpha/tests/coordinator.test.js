import test from 'node:test';
import assert from 'node:assert/strict';
import { Coordinator } from '../src/coordinator.js';
import { monteCarlo } from '../src/workloads.js';
test('suite fails explicitly when all selected nodes vanish', () => {
  const c = new Coordinator(); c.engine.addNode('a', 'a', { workload: monteCarlo.id, rate: 100 });
  c.startSuite({ params: { samples: 10000, seed: 42 }, repeats: 1 });
  c.engine.removeNode('a'); c.tick(); assert.equal(c.suite.status, 'failed'); assert.match(c.suite.error, /No selected nodes/);
});
test('suite validates before mutating active state and can cancel', () => {
  const c = new Coordinator(); c.engine.addNode('a', 'a', { workload: monteCarlo.id, rate: 100 });
  assert.throws(() => c.startSuite({ params: { samples: 10000, seed: 42 }, repeats: -1 }));
  assert.equal(c.suite, null);
  c.startSuite({ params: { samples: 10000, seed: 42 }, repeats: 1 }); c.cancel();
  assert.equal(c.suite.status, 'cancelled'); assert.equal(c.engine.job.status, 'failed');
});
test('completed sequence matches baseline and persists once', () => {
  let clock = 0, saves = 0; const queue = [];
  const c = new Coordinator({ now: () => clock, save: () => { saves++; }, send: (id, event, data) => { if (event === 'task') queue.push({ id, ...data }); return true; } });
  for (const id of ['a', 'b', 'c']) c.engine.addNode(id, id, { workload: monteCarlo.id, rate: 100 });
  c.startSuite({ params: { samples: 100000, seed: 42 }, repeats: 3 });
  while (c.suite.status === 'running') {
    const m = queue.shift(); if (m) { clock += 1; c.engine.accept(m.id, { jobId: m.jobId, taskId: m.task.id, attempt: m.task.attempt, result: monteCarlo.compute(m.task), computeMs: 1 }); }
    c.tick();
  }
  assert.equal(c.suite.pairs.length, 3); assert.ok(c.suite.pairs.every(p => p.verified)); assert.equal(saves, 1);
  c.tick(); assert.equal(saves, 1);
});
