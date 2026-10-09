import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { pathToFileURL } from 'node:url';
import { BatchQueue } from '../src/batch-queue.js';
import { SqliteBatchStore } from '../src/sqlite-batch-store.js';
import { monteCarlo } from '../src/workloads.js';

// This measures local coordinator/SQLite polling overhead only. Workers and
// network are represented by sequential virtual pollers; compute is synthetic.
export function runBatchLoad({ nodes = 1_000, tasks = 1_000 } = {}) {
  if (!Number.isSafeInteger(nodes) || nodes < 1 || !Number.isSafeInteger(tasks) || tasks < 1) throw Error('nodes and tasks must be positive integers');
  const dir = join(tmpdir(), `macn-batch-load-${randomUUID()}`), filename = join(dir, 'load.sqlite');
  mkdirSync(dir, { recursive: true });
  const store = new SqliteBatchStore(filename);
  const queue = new BatchQueue(store, { leaseMs: 60_000, maxClaim: 1 });
  const job = queue.createJob({ workloadId: monteCarlo.id, params: { samples: tasks * 1_000, seed: 42 }, chunkSize: 1_000 });
  const memoryBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  let completed = 0, polls = 0;
  try {
    // Cycle through virtual node IDs. Each poll receives at most one task and
    // immediately returns a valid deterministic-shape synthetic result.
    while (completed < tasks) {
      for (let i = 0; i < nodes && completed < tasks; i++) {
        polls++;
        const [task] = queue.claim({ jobId: job.id, nodeId: `virtual-${i}`, limit: 1 });
        if (!task) continue;
        const accepted = queue.submit({ jobId: job.id, taskId: task.id, nodeId: `virtual-${i}`, leaseToken: task.leaseToken,
          result: { hits: 0, count: task.count }, computeMs: 0 });
        if (!accepted.accepted) throw Error('Synthetic result rejected');
        completed++;
      }
    }
    // Count the remaining configured nodes as idle poll requests once, exposing
    // the common high-fan-in empty-poll case without retaining client objects.
    const remainder = tasks % nodes;
    if (remainder > 0) {
      const idle = nodes - remainder;
      for (let i = 0; i < idle; i++) { polls++; queue.claim({ jobId: job.id, nodeId: `idle-${i}`, limit: 1 }); }
    }
    const elapsedMs = performance.now() - start;
    return { kind: 'local-coordinator-simulation', nodes, taskCount: tasks, completed: queue.getJob(job.id).completedUnits / 1_000,
      runtime: { node: process.version, platform: process.platform, arch: process.arch, logicalCpus: cpus().length, totalMemoryBytes: totalmem() },
      polls, elapsedMs: +elapsedMs.toFixed(2), pollsPerSecond: +(polls / (elapsedMs / 1_000)).toFixed(1),
      tasksPerSecond: +(tasks / (elapsedMs / 1_000)).toFixed(1), heapDeltaBytes: process.memoryUsage().heapUsed - memoryBefore,
      caveat: 'No real workers, network, device compute, or concurrent HTTP requests are included.' };
  } finally { queue.close(); rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [k, v] = arg.replace(/^--/, '').split('='); return [k, Number(v)]; }));
  const results = [1_000, 10_000, 100_000].map(nodes => runBatchLoad({ nodes, tasks: args.tasks || 1_000 }));
  console.log(JSON.stringify(results, null, 2));
}
