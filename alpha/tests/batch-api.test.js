import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { runBatchWorker } from '../src/batch-worker.js';
import { monteCarlo } from '../src/workloads.js';

test('HTTP batch job is shared by three pull workers and merged exactly once', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'macn-batch-api-'));
  const app = await startServer({ host: '127.0.0.1', port: 0, token: 'integration-token', quiet: true,
    saveReports: false, batchDatabase: join(dir, 'batch.sqlite') });
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const baseUrl = `http://127.0.0.1:${app.port}`;
  const headers = { authorization: `Bearer ${app.token}`, 'content-type': 'application/json' };
  assert.equal((await fetch(`${baseUrl}/api/batch/jobs`)).status, 401);
  const created = await fetch(`${baseUrl}/api/batch/jobs`, { method: 'POST', headers,
    body: JSON.stringify({ workloadId: 'monte-carlo-v1', params: { samples: 3_000, seed: 42 }, chunkSize: 1_000 }) });
  assert.equal(created.status, 201);
  const job = await created.json();
  const leaseProbe = await (await fetch(`${baseUrl}/api/batch/jobs`, { method: 'POST', headers,
    body: JSON.stringify({ workloadId: 'monte-carlo-v1', params: { samples: 1_000, seed: 9 }, chunkSize: 1_000 }) })).json();
  const claimed = await (await fetch(`${baseUrl}/api/batch/jobs/${leaseProbe.id}/work`, { method: 'POST', headers,
    body: JSON.stringify({ nodeId: 'renew-probe' }) })).json();
  const taskId = claimed.tasks[0].id;
  const renewed = await fetch(`${baseUrl}/api/batch/jobs/${leaseProbe.id}/leases/renew`, { method: 'POST', headers,
    body: JSON.stringify({ nodeId: 'renew-probe', leases: [{ taskId, leaseToken: claimed.tasks[0].leaseToken }] }) });
  assert.deepEqual(await renewed.json(), { renewed: [taskId], lost: [] });
  const workers = ['desktop', 'laptop', 'phone-sim'].map(nodeId => runBatchWorker({ baseUrl, token: app.token,
    nodeId, jobId: job.id, pollMs: 10, spoolFile: join(dir, `${nodeId}-spool.sqlite`),
    signal: AbortSignal.timeout(10_000), onEvent() {} }));
  await Promise.all(workers);
  const response = await fetch(`${baseUrl}/api/batch/jobs/${job.id}`, { headers });
  const result = await response.json();
  assert.equal(result.status, 'completed');
  assert.equal(result.completedUnits, 3_000);
  assert.equal(result.tasks.completed, 3);
  assert.equal(result.tasks.failed, 0);
  assert.ok(result.result.pi > 3 && result.result.pi < 3.3);
});

test('HTTP API reports pending and verified states for sampled redundant work', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'macn-batch-verify-api-'));
  const app = await startServer({ host: '127.0.0.1', port: 0, token: 'integration-token', quiet: true,
    saveReports: false, batchDatabase: join(dir, 'batch.sqlite') });
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const baseUrl = `http://127.0.0.1:${app.port}`;
  const headers = { authorization: `Bearer ${app.token}`, 'content-type': 'application/json' };
  const created = await fetch(`${baseUrl}/api/batch/jobs`, { method: 'POST', headers,
    body: JSON.stringify({ workloadId: monteCarlo.id, params: { samples: 1_000, seed: 32 }, chunkSize: 1_000,
      verification: { mode: 'trusted', redundancySampleRate: 1 } }) });
  const job = await created.json();
  const claim = async nodeId => (await fetch(`${baseUrl}/api/batch/jobs/${job.id}/work`, { method: 'POST', headers,
    body: JSON.stringify({ nodeId }) })).json();
  const first = (await claim('http-a')).tasks[0];
  const correct = monteCarlo.compute(first.payload);
  const submitted = await fetch(`${baseUrl}/api/batch/jobs/${job.id}/results`, { method: 'POST', headers,
    body: JSON.stringify({ taskId: first.id, nodeId: 'http-a', leaseToken: first.leaseToken, result: correct, computeMs: 4 }) });
  assert.equal(submitted.status, 202);
  let status = await (await fetch(`${baseUrl}/api/batch/jobs/${job.id}`, { headers })).json();
  assert.equal(status.completedUnits, 0);
  assert.equal(status.verification.pending, 1);
  assert.equal((await claim('http-a')).tasks.length, 0);
  const second = (await claim('http-b')).tasks[0];
  assert.equal(second.id, first.id);
  const bad = { ...correct, hits: correct.hits + 1 };
  const confirmed = await fetch(`${baseUrl}/api/batch/jobs/${job.id}/results`, { method: 'POST', headers,
    body: JSON.stringify({ taskId: second.id, nodeId: 'http-b', leaseToken: second.leaseToken, result: bad, computeMs: 5 }) });
  assert.equal(confirmed.status, 200);
  status = await (await fetch(`${baseUrl}/api/batch/jobs/${job.id}`, { headers })).json();
  assert.equal(status.status, 'completed');
  assert.equal(status.verification.verified, 1);
  assert.equal(status.verification.rejected, 1);
  assert.equal(status.verification.accepted, 1);
});
