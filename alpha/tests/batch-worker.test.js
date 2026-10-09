import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateRateEstimate } from '../src/batch-worker.js';
import { runBatchWorker } from '../src/batch-worker.js';
import { startServer } from '../src/server.js';
import { monteCarlo } from '../src/workloads.js';

test('worker capacity estimate adapts in workload units per second', () => {
  assert.equal(updateRateEstimate(100, 100, 500, 0.5), 150);
  assert.equal(updateRateEstimate(10_000, 20_000, 1_000, 1), 20_000);
  assert.throws(() => updateRateEstimate(100, 100, 0), /Invalid/);
});

test('Batch worker submits its measured rate to the queue in units per second', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'macn-worker-rate-'));
  const app = await startServer({ port: 0, host: '127.0.0.1', token: 'test-token', quiet: true,
    saveReports: false, batchDatabase: join(dir, 'coordinator.sqlite') });
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const job = app.batchQueue.createJob({ workloadId: monteCarlo.id, params: { samples: 1_000, seed: 42 }, chunkSize: 1_000 });
  const originalClaim = app.batchQueue.claim.bind(app.batchQueue);
  let submittedRate;
  app.batchQueue.claim = options => {
    if (submittedRate === undefined) submittedRate = options.unitsPerSecond;
    return originalClaim(options);
  };
  const events = [];
  await runBatchWorker({ baseUrl: `http://127.0.0.1:${app.port}`, token: app.token, nodeId: 'rate-test', jobId: job.id,
    spoolFile: join(dir, 'spool.sqlite'), pollMs: 1, signal: AbortSignal.timeout(10_000), onEvent: event => events.push(event) });
  const initial = events.find(event => event.type === 'worker-start').benchmark;
  assert.equal(submittedRate, initial.unitsPerSecond);
  assert.notEqual(submittedRate, initial.rate);
  assert.equal(app.batchQueue.getJob(job.id).status, 'completed');
});
