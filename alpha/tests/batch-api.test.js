import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
import { runBatchWorker } from '../src/batch-worker.js';

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
