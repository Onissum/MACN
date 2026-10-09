import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

test('trusted Monte Carlo verifier rejects plausible forged results without completing the task', t => {
  const f = fixture(); t.after(f.dispose);
  const job = f.queue.createJob({ workloadId: monteCarlo.id, params: { samples: 1_000, seed: 37 }, chunkSize: 1_000 });
  const badAttempt = f.queue.claim({ jobId: job.id, nodeId: 'dishonest', limit: 1 })[0];
  const forged = { ...result(badAttempt), hits: result(badAttempt).hits + 1 };
  const rejected = f.queue.submit({ jobId: job.id, taskId: badAttempt.id, nodeId: 'dishonest',
    leaseToken: badAttempt.leaseToken, result: forged, computeMs: 4 });
  assert.deepEqual(rejected, { accepted: false, reason: 'unverified-result' });
  assert.equal(f.queue.getJob(job.id).status, 'running');
  assert.equal(f.queue.getJob(job.id).completedUnits, 0);
  assert.equal(f.queue.getJob(job.id).verification.rejected, 1);
  const retry = f.queue.claim({ jobId: job.id, nodeId: 'honest', limit: 1 })[0];
  assert.equal(f.queue.submit({ jobId: job.id, taskId: retry.id, nodeId: 'honest', leaseToken: retry.leaseToken,
    result: result(retry), computeMs: 5 }).accepted, true);
  assert.equal(f.queue.getJob(job.id).verification.accepted, 1);
});

test('sampled redundant verification waits for a different worker and uses the trusted answer on disagreement', t => {
  const f = fixture(); t.after(f.dispose);
  const job = f.queue.createJob({ workloadId: monteCarlo.id, params: { samples: 1_000, seed: 91 }, chunkSize: 1_000,
    verification: { mode: 'trusted', redundancySampleRate: 1 } });
  const first = f.queue.claim({ jobId: job.id, nodeId: 'worker-a', limit: 1 })[0];
  const correct = result(first);
  const pending = f.queue.submit({ jobId: job.id, taskId: first.id, nodeId: 'worker-a', leaseToken: first.leaseToken,
    result: correct, computeMs: 8 });
  assert.equal(pending.pendingVerification, true);
  assert.equal(f.queue.getJob(job.id).completedUnits, 0);
  assert.deepEqual(f.queue.claim({ jobId: job.id, nodeId: 'worker-a', limit: 1 }), []);
  const second = f.queue.claim({ jobId: job.id, nodeId: 'worker-b', limit: 1 })[0];
  assert.equal(second.id, first.id);
  const wrong = { ...correct, hits: correct.hits + 1 };
  assert.equal(f.queue.submit({ jobId: job.id, taskId: second.id, nodeId: 'worker-b', leaseToken: second.leaseToken,
    result: wrong, computeMs: 9 }).accepted, true);
  const complete = f.queue.getJob(job.id);
  assert.equal(complete.status, 'completed');
  assert.equal(complete.result.hits, correct.hits);
  assert.equal(complete.verification.received, 2);
  assert.equal(complete.verification.verified, 1);
  assert.equal(complete.verification.rejected, 1);
  assert.equal(complete.verification.accepted, 1);
  assert.ok(complete.verification.verificationMs > 0);
});

test('redundant candidate survives restart and two false workers are retried without double counting', t => {
  const f = fixture(); t.after(f.dispose);
  const job = f.queue.createJob({ workloadId: monteCarlo.id, params: { samples: 1_000, seed: 191 }, chunkSize: 1_000,
    verification: { redundancySampleRate: 1 } });
  const first = f.queue.claim({ jobId: job.id, nodeId: 'worker-a' })[0];
  const right = result(first), bad = { ...right, hits: right.hits + 1 };
  assert.equal(f.queue.submit({ jobId: job.id, taskId: first.id, nodeId: 'worker-a', leaseToken: first.leaseToken,
    result: bad, computeMs: 7 }).pendingVerification, true);
  f.queue.close();
  f.queue = new BatchQueue(new SqliteBatchStore(join(f.dir, 'batch.sqlite')), { leaseMs: 100, now: () => 10_001 });
  const second = f.queue.claim({ jobId: job.id, nodeId: 'worker-b' })[0];
  assert.equal(second.id, first.id);
  assert.deepEqual(f.queue.submit({ jobId: job.id, taskId: second.id, nodeId: 'worker-b', leaseToken: second.leaseToken,
    result: bad, computeMs: 6 }), { accepted: false, reason: 'unverified-result' });
  assert.equal(f.queue.getJob(job.id).completedUnits, 0);
  const retry = f.queue.claim({ jobId: job.id, nodeId: 'worker-c' })[0];
  assert.equal(f.queue.submit({ jobId: job.id, taskId: retry.id, nodeId: 'worker-c', leaseToken: retry.leaseToken,
    result: right, computeMs: 5 }).pendingVerification, true);
  const final = f.queue.claim({ jobId: job.id, nodeId: 'worker-d' })[0];
  assert.equal(f.queue.submit({ jobId: job.id, taskId: final.id, nodeId: 'worker-d', leaseToken: final.leaseToken,
    result: right, computeMs: 5 }).accepted, true);
  assert.equal(f.queue.getJob(job.id).completedUnits, 1_000);
  assert.equal(f.queue.getJob(job.id).tasks.completed, 1);
});

test('verification policy is validated and redundancy is disabled by default', t => {
  const f = fixture(); t.after(f.dispose);
  assert.throws(() => f.queue.createJob({ workloadId: monteCarlo.id, params: { samples: 1_000, seed: 1 }, verification: { redundancySampleRate: 2 } }), /redundancySampleRate/);
  const job = f.queue.createJob({ workloadId: monteCarlo.id, params: { samples: 1_000, seed: 1 } });
  assert.deepEqual(job.verificationPolicy, { mode: 'trusted', redundancySampleRate: 0 });
});

test('additive migration preserves completed Alpha.4 jobs and accepts new verified work', t => {
  const dir = mkdtempSync(join(tmpdir(), 'macn-batch-legacy-'));
  const filename = join(dir, 'batch.sqlite');
  const legacy = new DatabaseSync(filename);
  legacy.exec(`CREATE TABLE batch_jobs (
    id TEXT PRIMARY KEY, workload_id TEXT NOT NULL, params_json TEXT NOT NULL,
    status TEXT NOT NULL, total_units INTEGER NOT NULL, next_unit INTEGER NOT NULL DEFAULT 0,
    chunk_size INTEGER NOT NULL, completed_units INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
    completed_at INTEGER, result_json TEXT, error TEXT
  );
  CREATE TABLE batch_tasks (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES batch_jobs(id), ordinal INTEGER NOT NULL,
    payload_json TEXT NOT NULL, count INTEGER NOT NULL, status TEXT NOT NULL, node_id TEXT, lease_token TEXT,
    lease_until INTEGER, attempts INTEGER NOT NULL DEFAULT 0, result_json TEXT, compute_ms REAL,
    created_at INTEGER NOT NULL, completed_at INTEGER, UNIQUE(job_id,ordinal)
  );
  INSERT INTO batch_jobs VALUES ('legacy', 'monte-carlo-v1', '{"samples":1000,"seed":4}', 'completed', 1000, 1000, 1000, 1000, 1, 2, '{"hits":800,"count":1000,"pi":3.2}', NULL);
  INSERT INTO batch_tasks VALUES ('legacy:task:0', 'legacy', 0, '{"start":0,"count":1000,"seed":4}', 1000, 'completed', 'old-worker', NULL, NULL, 1, '{"hits":800,"count":1000}', 5, 1, 2);`);
  legacy.close();
  const store = new SqliteBatchStore(filename);
  const queue = new BatchQueue(store, { leaseMs: 100, now: () => 10_000 });
  t.after(() => { queue.close(); rmSync(dir, { recursive: true, force: true }); });
  const previous = queue.getJob('legacy');
  assert.equal(previous.status, 'completed');
  assert.equal(previous.completedUnits, 1_000);
  assert.deepEqual(previous.result, { hits: 800, count: 1_000, pi: 3.2 });
  assert.equal(previous.tasks.completed, 1);
  assert.equal(previous.verification.accepted, 0);
  assert.equal(previous.verification.legacyAccepted, 1);
  const newJob = queue.createJob({ workloadId: monteCarlo.id, params: { samples: 1_000, seed: 4 }, chunkSize: 1_000 });
  const lease = queue.claim({ jobId: newJob.id, nodeId: 'new-worker' })[0];
  assert.equal(queue.submit({ jobId: newJob.id, taskId: lease.id, nodeId: 'new-worker', leaseToken: lease.leaseToken,
    result: result(lease), computeMs: 3 }).verified, true);
});

test('retry limit fails a repeatedly abandoned task and job', t => {
  const f = fixture({ maxAttempts: 1 }); t.after(f.dispose);
  const job = f.queue.createJob({ workloadId: monteCarlo.id, params: { samples: 1_000, seed: 5 }, chunkSize: 1_000 });
  f.queue.claim({ jobId: job.id, nodeId: 'gone', limit: 1 });
  f.setNow(10_101);
  assert.deepEqual(f.queue.claim({ jobId: job.id, nodeId: 'next', limit: 1 }), []);
  assert.equal(f.queue.getJob(job.id).status, 'failed');
});
