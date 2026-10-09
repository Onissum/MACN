import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteBatchStore } from '../src/sqlite-batch-store.js';
import { BatchQueue } from '../src/batch-queue.js';
import { monteCarlo } from '../src/workloads.js';

function fixture(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'macn-batch-'));
  let now = 10_000;
  const store = new SqliteBatchStore(join(dir, 'batch.sqlite'));
  const queue = new BatchQueue(store, { leaseMs: 100, now: () => now, ...options });
  return { dir, queue, setNow(value) { now = value; }, dispose() { queue.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function result(task) { return monteCarlo.compute(task.payload); }

test('batch job allocates bounded work, accepts results once, and completes deterministically', t => {
  const f = fixture(); t.after(f.dispose);
  const job = f.queue.createJob({ workloadId: monteCarlo.id, params: { samples: 2_000, seed: 42 }, chunkSize: 1_000 });
  const first = f.queue.claim({ jobId: job.id, nodeId: 'pc', limit: 1 })[0];
  const task = f.queue.claim({ jobId: job.id, nodeId: 'phone', limit: 1 })[0];
  const payloadResult = result(task);
  assert.equal(f.queue.submit({ jobId: job.id, taskId: task.id, nodeId: 'phone', leaseToken: task.leaseToken, result: payloadResult, computeMs: 10 }).accepted, true);
  assert.equal(f.queue.submit({ jobId: job.id, taskId: task.id, nodeId: 'phone', leaseToken: task.leaseToken, result: payloadResult, computeMs: 10 }).duplicate, true);
  f.queue.submit({ jobId: job.id, taskId: first.id, nodeId: 'pc', leaseToken: first.leaseToken, result: result(first), computeMs: 10 });
  const done = f.queue.getJob(job.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.completedUnits, 2_000);
  assert.equal(done.result.count, 2_000);
});

test('expired lease is reassigned and late owner cannot submit', t => {
  const f = fixture(); t.after(f.dispose);
  const job = f.queue.createJob({ workloadId: monteCarlo.id, params: { samples: 1_000, seed: 1 }, chunkSize: 1_000 });
  const lost = f.queue.claim({ jobId: job.id, nodeId: 'slow', limit: 1 })[0];
  f.setNow(10_101);
  const reassigned = f.queue.claim({ jobId: job.id, nodeId: 'replacement', limit: 1 })[0];
  assert.equal(lost.id, reassigned.id);
  assert.equal(reassigned.attempt, 2);
  assert.deepEqual(f.queue.submit({ jobId: job.id, taskId: lost.id, nodeId: 'slow', leaseToken: lost.leaseToken, result: result(lost), computeMs: 100 }),
    { accepted: false, reason: 'stale-lease' });
  assert.equal(f.queue.getJob(job.id).tasks.reassignments, 1);
});

test('measured capacity sizes pull packages within configured limits', t => {
  const f = fixture({ maxClaim: 8, leaseMs: 1_000 }); t.after(f.dispose);
  const create = () => f.queue.createJob({ workloadId: monteCarlo.id, params: { samples: 10_000, seed: 4 }, chunkSize: 1_000 });
  const fastJob = create(), slowJob = create();
  const fast = f.queue.claim({ jobId: fastJob.id, nodeId: 'fast', unitsPerSecond: 100_000, targetSeconds: 1 });
  const slow = f.queue.claim({ jobId: slowJob.id, nodeId: 'slow', unitsPerSecond: 100, targetSeconds: 1 });
  assert.equal(fast.length, 8);
  assert.equal(slow.length, 1);
  assert.ok(fast.every(task => task.leaseUntil > 10_000 + 1_000));
  assert.throws(() => f.queue.claim({ jobId: slowJob.id, nodeId: 'invalid', unitsPerSecond: 0, targetSeconds: 1 }), /unitsPerSecond/);
});

test('faster workers reserve work in proportion to units per second and receive sufficient leases', t => {
  const f = fixture({ leaseMs: 1_000, leaseSafetyMarginMs: 1_000, maxClaim: 32 }); t.after(f.dispose);
  const job = f.queue.createJob({ workloadId: monteCarlo.id, params: { samples: 100_000, seed: 4 }, chunkSize: 1_000 });
  const fast = f.queue.claim({ jobId: job.id, nodeId: 'fast', unitsPerSecond: 10_000, targetSeconds: 1 });
  const slow = f.queue.claim({ jobId: job.id, nodeId: 'slow', unitsPerSecond: 2_000, targetSeconds: 1 });
  assert.equal(fast.length, 10);
  assert.equal(slow.length, 2);
  assert.equal(fast.length / slow.length, 10_000 / 2_000);
  assert.ok(fast.every(task => task.leaseMs >= Math.ceil((fast.length * 1_000 / 10_000) * 2_000 + 1_000)));
  assert.ok(slow.every(task => task.leaseMs >= Math.ceil((slow.length * 1_000 / 2_000) * 2_000 + 1_000)));
});

test('lease renewal extends active work but cannot revive an expired lease', t => {
  const f = fixture({ leaseMs: 100 }); t.after(f.dispose);
  const job = f.queue.createJob({ workloadId: monteCarlo.id, params: { samples: 1_000, seed: 7 }, chunkSize: 1_000 });
  const task = f.queue.claim({ jobId: job.id, nodeId: 'worker', limit: 1 })[0];
  f.setNow(10_050);
  assert.deepEqual(f.queue.renew({ jobId: job.id, nodeId: 'worker', leases: [{ taskId: task.id, leaseToken: task.leaseToken }] }),
    { renewed: [task.id], lost: [] });
  f.setNow(10_151);
  assert.deepEqual(f.queue.renew({ jobId: job.id, nodeId: 'worker', leases: [{ taskId: task.id, leaseToken: task.leaseToken }] }),
    { renewed: [], lost: [task.id] });
});

test('task ledger survives coordinator restart', t => {
  const f = fixture(); t.after(f.dispose);
  const job = f.queue.createJob({ workloadId: monteCarlo.id, params: { samples: 1_000, seed: 5 }, chunkSize: 500 });
  const task = f.queue.claim({ jobId: job.id, nodeId: 'node', limit: 1 })[0];
  f.queue.close();
  const reopened = new BatchQueue(new SqliteBatchStore(join(f.dir, 'batch.sqlite')), { leaseMs: 100, now: () => 10_001 });
  f.queue = reopened;
  assert.equal(reopened.getJob(job.id).tasks.leased, 1);
  assert.equal(reopened.claim({ jobId: job.id, nodeId: 'other', limit: 1 }).length, 1);
  assert.equal(task.id, `${job.id}:task:0`);
});

test('accepted task results survive coordinator restart without being counted twice', t => {
  const f = fixture(); t.after(f.dispose);
  const job = f.queue.createJob({ workloadId: monteCarlo.id, params: { samples: 2_000, seed: 17 }, chunkSize: 1_000 });
  const first = f.queue.claim({ jobId: job.id, nodeId: 'worker-a', limit: 1 })[0];
  const firstResult = result(first);
  assert.equal(f.queue.submit({ jobId: job.id, taskId: first.id, nodeId: 'worker-a', leaseToken: first.leaseToken,
    result: firstResult, computeMs: 12 }).accepted, true);
  f.queue.close();
  f.queue = new BatchQueue(new SqliteBatchStore(join(f.dir, 'batch.sqlite')), { leaseMs: 100, now: () => 10_001 });

  const resumed = f.queue.getJob(job.id);
  assert.equal(resumed.completedUnits, 1_000);
  assert.equal(resumed.tasks.completed, 1);
  assert.equal(f.queue.submit({ jobId: job.id, taskId: first.id, nodeId: 'worker-a', leaseToken: first.leaseToken,
    result: firstResult, computeMs: 12 }).duplicate, true);
  const second = f.queue.claim({ jobId: job.id, nodeId: 'worker-b', limit: 1 })[0];
  assert.equal(second.payload.start, 1_000);
  assert.equal(f.queue.submit({ jobId: job.id, taskId: second.id, nodeId: 'worker-b', leaseToken: second.leaseToken,
    result: result(second), computeMs: 15 }).jobStatus, 'completed');
  const completed = f.queue.getJob(job.id);
  assert.equal(completed.completedUnits, 2_000);
  assert.deepEqual(completed.result, monteCarlo.merge([monteCarlo.compute({ start: 0, count: 2_000, seed: 17 })]));
});

test('retry limit fails a repeatedly abandoned task and job', t => {
  const f = fixture({ maxAttempts: 1 }); t.after(f.dispose);
  const job = f.queue.createJob({ workloadId: monteCarlo.id, params: { samples: 1_000, seed: 5 }, chunkSize: 1_000 });
  f.queue.claim({ jobId: job.id, nodeId: 'gone', limit: 1 });
  f.setNow(10_101);
  assert.deepEqual(f.queue.claim({ jobId: job.id, nodeId: 'next', limit: 1 }), []);
  assert.equal(f.queue.getJob(job.id).status, 'failed');
});
