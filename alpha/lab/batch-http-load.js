import { pathToFileURL } from 'node:url';
import { startServer } from '../src/server.js';

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return +sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)].toFixed(3);
};

// Local HTTP concurrency probe. This includes HTTP parsing, auth, JSON,
// synchronous SQLite work and loopback sockets, but not remote network/device compute.
export async function runBatchHttpLoad({ clients = 32, requests = 2_000, taskCount = 500 } = {}) {
  for (const [name, value] of Object.entries({ clients, requests, taskCount })) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) throw Error(`${name} must be an integer from 1 to 100000`);
  }
  if (clients > requests) throw Error('clients cannot exceed requests');
  const token = 'local-load-test-token';
  const app = await startServer({ port: 0, host: '127.0.0.1', token, quiet: true, saveReports: false,
    batchDatabase: ':memory:', batch: true });
  const base = `http://127.0.0.1:${app.port}/api/batch`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const samples = Math.max(1_000, taskCount * 2);
  const response = await fetch(`${base}/jobs`, { method: 'POST', headers, body: JSON.stringify({
    workloadId: 'monte-carlo-v1', params: { samples, seed: 42 }, chunkSize: Math.ceil(samples / taskCount)
  }) });
  if (!response.ok) { await app.close(); throw Error(`Job creation failed: HTTP ${response.status}`); }
  const { id: jobId } = await response.json();
  const latencies = []; let nextRequest = 0, allocations = 0, errors = 0, nonSuccess = 0;
  const memoryBefore = process.memoryUsage();
  const started = performance.now();
  async function clientLoop(clientId) {
    while (true) {
      const requestId = nextRequest++;
      if (requestId >= requests) return;
      const at = performance.now();
      try {
        const res = await fetch(`${base}/jobs/${jobId}/work`, { method: 'POST', headers,
          body: JSON.stringify({ nodeId: `load-${clientId}`, limit: 1 }) });
        const body = await res.json();
        latencies.push(performance.now() - at);
        if (!res.ok) nonSuccess++;
        allocations += body.tasks?.length ?? 0;
      } catch { errors++; }
    }
  }
  try {
    await Promise.all(Array.from({ length: clients }, (_, i) => clientLoop(i)));
    const elapsedMs = performance.now() - started;
    const memoryAfter = process.memoryUsage();
    if (errors || nonSuccess || allocations !== taskCount) throw Error(`Probe incomplete: ${errors} transport errors, ${nonSuccess} HTTP errors, ${allocations}/${taskCount} tasks allocated`);
    return { kind: 'local-http-concurrency-probe', clients, requests, taskCount, allocations,
      errors, nonSuccess, elapsedMs: +elapsedMs.toFixed(2), requestsPerSecond: +(requests / elapsedMs * 1_000).toFixed(1),
      latencyMs: { p50: percentile(latencies, .50), p95: percentile(latencies, .95), p99: percentile(latencies, .99), max: +Math.max(...latencies).toFixed(3) },
      process: { node: process.version, platform: process.platform, arch: process.arch,
        rssDeltaBytes: memoryAfter.rss - memoryBefore.rss, heapDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed },
      caveat: 'Loopback HTTP to one local coordinator and in-memory SQLite; no remote network, persistent-disk contention, real worker compute, or multi-host behavior.' };
  } finally { await app.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [k, v] = arg.replace(/^--/, '').split('='); return [k, Number(v)]; }));
  console.log(JSON.stringify(await runBatchHttpLoad({ clients: args.clients || 32, requests: args.requests || 2_000,
    taskCount: args.tasks || 500 }), null, 2));
}
