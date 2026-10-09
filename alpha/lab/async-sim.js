import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SqliteBatchStore } from '../src/sqlite-batch-store.js';
import { BatchQueue } from '../src/batch-queue.js';
import { monteCarlo } from '../src/workloads.js';

const defaultWorkers = [
  { id: 'desktop', unitsPerSecond: 200_000, targetSeconds: 1 },
  { id: 'laptop', unitsPerSecond: 60_000, targetSeconds: 1 },
  { id: 'old-pc', unitsPerSecond: 12_000, targetSeconds: 1 }
];

// Discrete-event simulator: virtual time advances to task completion, node
// outage/recovery, polling, or lease expiry. It exercises BatchQueue + SQLite,
// while task compute duration is modeled from the worker's measured rate.
export async function runAsyncSimulation({ samples = 300_000, seed = 42, chunkSize = 5_000, workers = defaultWorkers,
  pollMs = 250, leaseMs = 5_000, leaseSafetyMarginMs = 5_000, maxAttempts = 4, maxClaim = 32,
  maxVirtualMs = 24 * 60 * 60 * 1_000 } = {}) {
  if (!Number.isSafeInteger(samples) || samples < 1_000 || !Array.isArray(workers) || workers.length < 1) throw Error('Invalid sample or worker configuration');
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || !Number.isFinite(pollMs) || pollMs < 1) throw Error('Invalid chunkSize or pollMs');
  const ids = new Set();
  const nodes = workers.map(spec => {
    if (!spec || typeof spec.id !== 'string' || !/^[\w.-]{1,80}$/.test(spec.id) || ids.has(spec.id) ||
        !Number.isFinite(spec.unitsPerSecond) || spec.unitsPerSecond <= 0) throw Error('Invalid worker profile');
    ids.add(spec.id);
    const offlineAtMs = spec.offlineAtMs ?? null;
    const offlineForMs = spec.offlineForMs ?? 0;
    if (offlineAtMs !== null && (!Number.isFinite(offlineAtMs) || offlineAtMs < 0 || !Number.isFinite(offlineForMs) || offlineForMs < 0)) throw Error('Invalid worker outage');
    return { ...spec, targetSeconds: spec.targetSeconds ?? 2, online: true, outageTriggered: false,
      offlineAtMs, offlineForMs, onlineAtMs: null, nextPollAt: 0, local: [], active: null,
      assigned: 0, accepted: 0, acceptedUnits: 0, wastedUnits: 0 };
  });

  let now = 0;
  const store = new SqliteBatchStore(':memory:');
  const queue = new BatchQueue(store, { leaseMs, leaseSafetyMarginMs, maxAttempts, maxClaim, now: () => Math.floor(now) });
  const job = queue.createJob({ workloadId: monteCarlo.id, params: { samples, seed }, chunkSize });
  const leases = new Map();
  let polls = 0, completedResults = 0;
  const acceptedTaskIds = new Set();

  const startNext = node => {
    while (node.local.length) {
      const task = node.local.shift();
      if (task.leaseUntil <= now) { node.wastedUnits += task.count; continue; }
      const durationMs = task.count / node.unitsPerSecond * 1_000;
      node.active = { task, startedAt: now, finishAt: now + Math.max(0.01, durationMs), durationMs };
      return;
    }
  };

  try {
    while (queue.getJob(job.id).status === 'running') {
      let changed = false;
      for (const node of nodes) {
        if (node.online && !node.outageTriggered && node.offlineAtMs !== null && now >= node.offlineAtMs) {
          node.outageTriggered = true; node.online = false;
          if (node.active) { node.wastedUnits += node.active.task.count; node.active = null; }
          node.wastedUnits += node.local.reduce((sum, task) => sum + task.count, 0); node.local = [];
          node.onlineAtMs = node.offlineAtMs + node.offlineForMs;
          changed = true;
        }
        if (!node.online && node.onlineAtMs !== null && now >= node.onlineAtMs) {
          node.online = true; node.onlineAtMs = null; node.nextPollAt = now; changed = true;
        }
      }

      for (const node of nodes) {
        if (!node.active || node.active.finishAt > now) continue;
        const { task, durationMs } = node.active;
        const result = monteCarlo.compute(task.payload);
        const outcome = await queue.submit({ jobId: job.id, taskId: task.id, nodeId: node.id, leaseToken: task.leaseToken,
          result, computeMs: durationMs });
        leases.delete(task.id);
        if (outcome.accepted && !acceptedTaskIds.has(task.id)) {
          acceptedTaskIds.add(task.id); node.accepted++; node.acceptedUnits += task.count; completedResults++;
        } else node.wastedUnits += task.count;
        node.active = null; node.nextPollAt = now; changed = true;
      }

      // Rotate who polls first at equal virtual times; fast nodes naturally
      // revisit the pull endpoint more often because their tasks finish sooner.
      for (let offset = 0; offset < nodes.length; offset++) {
        const index = (Math.floor(now / Math.max(1, pollMs)) + offset) % nodes.length;
        const node = nodes[index];
        if (!node.online || node.active || now < node.nextPollAt) continue;
        if (!node.local.length) {
          polls++;
          const claimed = queue.claim({ jobId: job.id, nodeId: node.id, unitsPerSecond: node.unitsPerSecond, targetSeconds: node.targetSeconds });
          if (claimed.length) {
            node.assigned += claimed.length;
            node.local.push(...claimed);
            for (const task of claimed) leases.set(task.id, task.leaseUntil);
          } else node.nextPollAt = now + pollMs;
        }
        startNext(node);
        if (node.active) changed = true;
      }

      if (queue.getJob(job.id).status !== 'running') break;
      if (changed) continue;

      const events = [];
      for (const node of nodes) {
        if (node.active) events.push(node.active.finishAt);
        if (node.online && !node.active) events.push(Math.max(now + 0.01, node.nextPollAt));
        if (node.online && !node.outageTriggered && node.offlineAtMs !== null && node.offlineAtMs > now) events.push(node.offlineAtMs);
        if (!node.online && node.onlineAtMs !== null && node.onlineAtMs > now) events.push(node.onlineAtMs);
      }
      for (const until of leases.values()) if (until > now) events.push(until);
      if (!events.length) throw Error('Simulation deadlocked: no future event can make progress');
      now = Math.min(...events);
      if (now > maxVirtualMs) throw Error(`Simulation exceeded ${maxVirtualMs} virtual ms`);
    }

    const final = queue.getJob(job.id);
    const baseline = monteCarlo.compute({ start: 0, count: samples, seed });
    if (final.status !== 'completed' || final.result.hits !== baseline.hits || final.result.count !== baseline.count) throw Error('Async result differs from sequential baseline');
    const fastestRate = Math.max(...nodes.map(node => node.unitsPerSecond));
    const baselineMs = samples / fastestRate * 1_000;
    return { kind: 'discrete-event-async-simulation', virtual: true, resultVerified: true, samples, seed, chunkSize,
      elapsedVirtualMs: +now.toFixed(2), singleFastestNodeMs: +baselineMs.toFixed(2), speedupVsFastestNode: +(baselineMs / now).toFixed(3),
      completedTasks: final.tasks.completed, reassignments: final.tasks.reassignments, polls,
      result: final.result, nodes: nodes.map(node => ({ id: node.id, unitsPerSecond: node.unitsPerSecond,
        tasksClaimedIncludingRetries: node.assigned, tasksAccepted: node.accepted, unitsAccepted: node.acceptedUnits,
        wastedUnits: node.wastedUnits, offlineAtMs: node.offlineAtMs, offlineForMs: node.offlineForMs })),
      caveat: 'Virtual task times and outages exercise the real BatchQueue/SQLite lifecycle; no network, simultaneous HTTP clients, or physical device runtime is measured.' };
  } finally { await queue.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [key, ...rest] = arg.replace(/^--/, '').split('='); return [key, rest.join('=')]; }));
  let output;
  if (!args.scenario || args.scenario === 'steady') {
    output = await runAsyncSimulation({ samples: Number(args.samples || 300_000), seed: Number(args.seed || 42) });
  } else if (args.scenario === 'disconnect') {
    output = await runAsyncSimulation({ samples: Number(args.samples || 10_000), seed: Number(args.seed || 42), chunkSize: 100,
      pollMs: 50, leaseMs: 1_000, leaseSafetyMarginMs: 1_000,
      workers: [{ id: 'desktop', unitsPerSecond: 10_000, targetSeconds: 1 }, { id: 'laptop', unitsPerSecond: 5_000, targetSeconds: 1 },
        { id: 'old-pc', unitsPerSecond: 100, targetSeconds: 1, offlineAtMs: 100, offlineForMs: 10_000 }] });
  } else throw Error(`Unknown async simulation scenario: ${args.scenario}`);
  output.scenario = args.scenario || 'steady';
  if (args.out) {
    const filename = resolve(args.out); await mkdir(dirname(filename), { recursive: true });
    await writeFile(filename, JSON.stringify(output, null, 2));
  }
  console.log(JSON.stringify(output, null, 2));
}
