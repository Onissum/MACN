import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BatchResultSpool } from '../src/batch-spool.js';

test('worker result spool survives restart and removes delivered results', t => {
  const dir = mkdtempSync(join(tmpdir(), 'macn-spool-')), file = join(dir, 'outbox.sqlite');
  let spool = new BatchResultSpool(file);
  t.after(() => { spool.close(); rmSync(dir, { recursive: true, force: true }); });
  const item = { jobId: 'job', taskId: 'task', nodeId: 'node', leaseToken: 'fenced-token', result: { hits: 7, count: 10 }, computeMs: 3.5, createdAt: 42 };
  spool.put(item); spool.close();
  spool = new BatchResultSpool(file);
  assert.deepEqual(spool.list('job'), [item]);
  assert.deepEqual(spool.list('other-job'), []);
  spool.delete('job', 'task');
  assert.deepEqual(spool.list('job'), []);
});
