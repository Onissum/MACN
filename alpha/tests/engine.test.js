import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskEngine } from '../src/engine.js';
import { AdaptiveScheduler, percentiles } from '../src/scheduler.js';
import { monteCarlo } from '../src/workloads.js';
function fixture(opts = {}) {
  let clock = 0; const messages = [];
  const engine = new TaskEngine({ now: () => clock, send: (id, type, data) => { if (type === 'task') messages.push({ id, ...data }); return true; }, ...opts });
  const node = (id, rate = 100) => engine.addNode(id, id, { workload: monteCarlo.id, rate });
  const advance = ms => { clock += ms; };
  const reply = m => engine.accept(m.id, { jobId: m.jobId, taskId: m.task.id, attempt: m.task.attempt, computeMs: 10, result: monteCarlo.compute(m.task) });
  const start = (samples = 100000, ids) => engine.start({ params: { samples, seed: 42 }, nodeIds: ids });
  return { engine, messages, node, advance, reply, start };
}
test('proportional chunk allocation and bounded adaptation', () => {
  const s = new AdaptiveScheduler();
  assert.equal(s.chunk({ rate: 100 }, 1e6), 15000);
  assert.equal(s.chunk({ rate: 300 }, 1e6), 45000);
  const n = { rate: 300, initialRate: 300 }; s.observe(n, 3000, 100);
  assert.ok(n.rate < 300 && n.rate > 30); assert.equal(n.slow, true);
  assert.equal(s.chunk(n, 123), 123);
});
test('three nodes complete exactly the sequential result across adaptive partitions', () => {
  const f = fixture(); f.node('pc', 100); f.node('phone', 20); f.node('laptop', 60); f.start();
  while (f.engine.job.status === 'running') { f.advance(20); f.reply(f.messages.shift()); }
  assert.deepEqual(f.engine.job.result, monteCarlo.merge([monteCarlo.compute({ start: 0, count: 100000, seed: 42 })]));
  assert.equal(f.engine.job.units, 100000);
  assert.ok([...f.engine.nodes.values()].every(n => n.completed > 0));
});
test('disconnect reassigns lease, fences late result, accepts retry only once', () => {
  const f = fixture(); f.node('a'); f.node('b'); f.start(); const old = f.messages.shift();
  f.engine.removeNode('a'); assert.equal(f.reply(old), false);
  while (f.engine.job.status === 'running') { f.advance(10); f.reply(f.messages.shift()); }
  assert.equal(f.engine.job.reassigned, 1); assert.equal(f.engine.job.units, 100000);
  assert.equal(f.reply(old), false); assert.equal(f.engine.job.duplicates, 1);
});
test('slow responsive node times out while fast node recovers its task', () => {
  const f = fixture(); f.node('slow'); f.node('fast'); f.start(); const late = f.messages.shift();
  f.advance(3100); f.engine.heartbeat('slow', 3); f.engine.heartbeat('fast', 2); f.reply(f.messages.shift()); f.engine.tick();
  assert.equal(f.engine.nodes.get('slow').slow, true); assert.equal(f.reply(late), false);
  while (f.engine.job.status === 'running') { f.advance(10); f.reply(f.messages.shift()); }
  assert.equal(f.engine.job.units, 100000); assert.ok(f.engine.job.reassigned >= 1);
});
test('parked fast node resumes when a still-in-flight task times out', () => {
  const f = fixture(); f.node('stalled'); f.node('fast'); f.start(1000000);
  const stalled = f.messages.find(m => m.id === 'stalled');
  const takeFast = () => { const index = f.messages.findIndex(m => m.id === 'fast'); return index < 0 ? null : f.messages.splice(index, 1)[0]; };
  let next = takeFast();
  while (next && f.engine.job.status === 'running') {
    f.advance(10); f.reply(next);
    next = takeFast();
  }
  assert.equal(f.engine.job.status, 'running');
  assert.ok(f.engine.parkedNodes.has('fast'));
  f.advance(4000); f.engine.tick();
  assert.ok(f.messages.some(m => m.id === 'fast' && m.task.id === stalled.task.id && m.task.attempt === 2));
  while (f.engine.job.status === 'running') {
    const message = takeFast();
    assert.ok(message, 'retry work must be dispatched to the surviving idle node');
    f.advance(10); f.reply(message);
  }
  assert.equal(f.engine.job.status, 'completed');
  assert.equal(f.engine.job.reassigned, 1);
  assert.equal(f.engine.job.units, 1000000);
});
test('heartbeat loss and all nodes absent preserve pending work for reconnect', () => {
  const f = fixture(); f.node('lost'); f.start(10000); const late = f.messages.shift(); f.advance(9000); f.engine.tick();
  assert.equal(f.engine.nodes.get('lost').connected, false); assert.equal(f.reply(late), false);
  // A new session is explicitly admitted to this job by the coordinator policy.
  f.node('new'); f.engine.job.nodeIds.push('new'); f.engine.job.nodeSet.add('new'); f.engine.idleNodes.add('new'); f.engine.dispatch(); f.reply(f.messages.shift());
  assert.equal(f.engine.job.status, 'completed');
});
test('duplicate and unknown results cannot inflate completion', () => {
  const f = fixture(); f.node('a'); f.start(); const m = f.messages.shift(); f.advance(10); assert.equal(f.reply(m), true);
  assert.equal(f.reply(m), false); assert.equal(f.engine.job.completed, 1);
  assert.equal(f.engine.accept('a', { jobId: f.engine.job.id, taskId: 'fake' }), false);
});
test('wrong attempt, wrong owner, stale job and invalid result rejected', () => {
  const f = fixture(); f.node('a'); f.node('b'); f.start(); const m = f.messages.shift();
  const msg = { jobId: m.jobId, taskId: m.task.id, attempt: m.task.attempt, result: { hits: 1, count: m.task.count }, computeMs: 1 };
  assert.equal(f.engine.accept('b', msg), false);
  assert.equal(f.engine.accept('a', { ...msg, attempt: 9 }), false);
  assert.equal(f.engine.accept('a', { ...msg, jobId: 'old' }), false);
  assert.equal(f.engine.accept('a', { ...msg, result: { hits: -1, count: 1 } }), false);
  assert.equal(f.engine.job.completed, 0); assert.equal(f.engine.job.reassigned, 1);
});
test('bounded retry failure and cancellation stop a job', () => {
  const f = fixture({ maxAttempts: 1 }); f.node('a'); f.start(); f.engine.removeNode('a');
  assert.equal(f.engine.job.status, 'failed'); assert.match(f.engine.job.error, /Retry limit/);
});
test('repeat jobs isolate IDs and prohibit concurrent starts', () => {
  const f = fixture(); f.node('a'); f.start(1000); assert.throws(() => f.start(), /already/);
  const old = f.messages.shift(); f.advance(5); f.reply(old); f.start(1000);
  assert.equal(f.reply(old), false); f.advance(5); f.reply(f.messages.shift()); assert.equal(f.engine.job.units, 1000);
});
test('percentiles use nearest rank; no samples are not zero latency', () => {
  assert.deepEqual(percentiles([]), { samples: 0, p50: null, p95: null, p99: null });
  assert.deepEqual(percentiles(Array.from({ length: 100 }, (_, i) => i + 1)), { samples: 100, p50: 50, p95: 95, p99: 99 });
});
test('deterministic workload validates inputs and partition invariance', () => {
  assert.throws(() => monteCarlo.validate({ samples: NaN, seed: 42 }));
  const a = monteCarlo.compute({ start: 0, count: 12345, seed: 7 });
  const b = monteCarlo.merge([monteCarlo.compute({ start: 0, count: 345, seed: 7 }), monteCarlo.compute({ start: 345, count: 12000, seed: 7 })]);
  assert.equal(a.hits, b.hits); assert.equal(a.count, b.count); assert.ok(Math.abs(b.pi - Math.PI) < 0.1);
});
test('short jobs reserve work for each idle node after rates grow', () => {
  const f = fixture(); f.node('fast', 1000000); f.node('b', 1000); f.node('c', 1000); f.start(10000);
  assert.equal(f.messages.length, 3);
  const ranges = f.messages.map(m => m.task); assert.equal(ranges.reduce((s, r) => s + r.count, 0), 10000);
  assert.ok(ranges.every(r => r.count > 0));
});
test('transport backpressure retries without losing a range', () => {
  let writable = false; const sent = [];
  const f = fixture({ send: (id, type, data) => { if (type === 'task' && writable) sent.push({ id, ...data }); return writable; } });
  f.node('a'); f.start(1000); assert.equal(f.engine.job.pending.length, 1);
  writable = true; f.advance(1001); f.engine.tick(); assert.equal(sent.length, 1);
  f.advance(1); assert.equal(f.reply(sent[0]), true); assert.equal(f.engine.job.units, 1000);
});
test('retry-limit abort prevents dispatch to further nodes in the same pass', () => {
  let sends = 0;
  const engine = new TaskEngine({ maxAttempts: 1, send: (_, event) => { if (event === 'task') sends++; return false; } });
  for (const id of ['a', 'b']) engine.addNode(id, id, { workload: monteCarlo.id, rate: 100 });
  engine.start({ params: { samples: 100000, seed: 42 } });
  assert.equal(engine.job.status, 'failed'); assert.equal(sends, 1);
});
test('extreme fractional rates cannot allocate beyond the workload boundary', () => {
  const f = fixture(); f.node('huge', 1e8); f.node('tiny', 0.001); f.node('fraction', 0.0037); f.start(10000);
  while (f.engine.job.status === 'running') { f.advance(1); f.reply(f.messages.shift()); }
  assert.equal(f.engine.job.units, 10000);
  assert.ok([...f.engine.job.tasks.values()].every(t => t.payload.start + t.count <= 10000));
});
