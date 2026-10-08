import test from 'node:test';
import assert from 'node:assert/strict';
import { JobBroker } from '../src/broker.js';
import { monteCarlo } from '../src/workloads.js';
function fixture(options = {}) {
  let clock = 0; const queue = [], owners = [];
  const broker = new JobBroker({ now: () => clock, ...options, send: (id, event, data) => { if (event === 'task') queue.push({ id, ...data }); return true; } });
  broker.addNode('a', 'node', { workload: monteCarlo.id, rate: 20 });
  const submit = owner => broker.submit({ owner, params: { samples: 100000, seed: 42 } });
  const complete = () => {
    const m = queue.shift(); assert.ok(m); clock += 5;
    owners.push(broker.jobs.get(m.requestId).owner);
    const reply = { requestId: m.requestId, jobId: m.jobId, taskId: m.task.id, attempt: m.task.attempt, result: monteCarlo.compute(m.task), computeMs: 1 };
    broker.accept(m.id, reply); return { m, reply };
  };
  return { broker, queue, owners, submit, complete, advance: ms => { clock += ms; } };
}
test('several owners share one slot without overlapping leases or starvation', () => {
  const f = fixture(); f.submit('alice'); f.submit('bob'); f.submit('alice');
  for (let i = 0; i < 8; i++) { assert.equal(f.queue.length, 1); f.complete(); }
  assert.ok(f.owners.includes('bob')); assert.ok(Math.abs(f.owners.filter(o => o === 'alice').length - f.owners.filter(o => o === 'bob').length) <= 2);
  while (f.broker.snapshot().some(j => j.status === 'running')) f.complete();
  assert.ok(f.broker.snapshot().every(j => j.result.count === 100000));
});
test('late duplicate from a previous job cannot clear another active lease', () => {
  const f = fixture(); f.submit('alice'); f.submit('bob'); const old = f.complete();
  const active = { ...f.broker.nodes.get('a').active };
  assert.equal(f.broker.accept('a', old.reply), false); assert.deepEqual(f.broker.nodes.get('a').active, active);
});
test('admission, ownership, cancellation and deadline are enforced', () => {
  const f = fixture({ maxPerOwner: 1, maxRuntimeMs: 50 }); const id = f.submit('alice');
  assert.throws(() => f.submit('alice'), /Admission/); assert.throws(() => f.broker.cancel(id, 'bob'), /owned/);
  f.broker.cancel(id, 'alice'); assert.equal(f.broker.nodes.get('a').active, null);
  f.submit('bob'); f.advance(60); f.broker.tick(); assert.equal(f.broker.snapshot().at(-1).status, 'failed');
});
test('node disappearance frees global slot and surviving node completes every job', () => {
  const f = fixture(); f.submit('alice'); f.submit('bob'); f.broker.removeNode('a'); f.queue.length = 0;
  f.broker.addNode('b', 'replacement', { workload: monteCarlo.id, rate: 50 });
  while (f.broker.snapshot().some(j => j.status === 'running')) f.complete();
  assert.ok(f.broker.snapshot().every(j => j.result.count === 100000));
});
test('completed request history is bounded and global heartbeat loss is detected', () => {
  const f = fixture({ maxJobs: 2, maxPerOwner: 1 });
  for (let i = 0; i < 10; i++) {
    const id = f.submit('owner-' + i); f.broker.cancel(id, 'owner-' + i); f.queue.length = 0;
  }
  assert.ok(f.broker.jobs.size <= 4);
  f.advance(9000); f.broker.tick(); assert.equal(f.broker.nodes.get('a').connected, false);
});
