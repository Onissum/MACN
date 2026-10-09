import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { benchmark } from './workloads.js';
import { BatchResultSpool } from './batch-spool.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function updateRateEstimate(previous, units, elapsedMs, alpha = 0.3) {
  if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(units) || units <= 0 ||
      !Number.isFinite(elapsedMs) || elapsedMs <= 0 || !Number.isFinite(alpha) || alpha <= 0 || alpha > 1) {
    throw Error('Invalid rate estimate input');
  }
  const measured = Math.min(1e12, units * 1_000 / elapsedMs);
  return previous * (1 - alpha) + measured * alpha;
}

export async function runBatchWorker({ baseUrl, token, nodeId, jobId, targetSeconds = 30, pollMs = 500,
  spoolFile = process.env.MACN_SPOOL_DB || join(homedir(), '.macn', `batch-spool-${String(nodeId || 'worker').replace(/[^\w.-]/g, '_')}.sqlite`),
  signal = AbortSignal.timeout(24 * 60 * 60 * 1000), onEvent = console.log }) {
  if (!baseUrl || !token || !nodeId || !jobId) throw Error('baseUrl, token, nodeId and jobId are required');
  const api = `${baseUrl.replace(/\/$/, '')}/api/batch`;
  const spool = new BatchResultSpool(spoolFile);
  const computeWorker = new Worker(new URL('./batch-compute-thread.js', import.meta.url));
  let requestId = 0;
  const pendingComputes = new Map();
  computeWorker.on('message', message => {
    const pending = pendingComputes.get(message.id);
    if (!pending) return;
    pendingComputes.delete(message.id);
    if (message.error) pending.reject(Error(message.error)); else pending.resolve(message.result);
  });
  computeWorker.on('error', error => { for (const pending of pendingComputes.values()) pending.reject(error); pendingComputes.clear(); });
  const compute = payload => new Promise((resolve, reject) => {
    const id = ++requestId; pendingComputes.set(id, { resolve, reject }); computeWorker.postMessage({ id, payload });
  });
  const request = async (path, body, method = 'POST') => {
    const response = await fetch(`${api}${path}`, { method, signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) { const error = Error(`HTTP ${response.status}: ${data.error || response.statusText}`); error.status = response.status; error.payload = data; throw error; }
    return data;
  };
  const postSpooled = async active => {
    for (const item of spool.list(jobId)) {
      try {
        const outcome = await request(`/jobs/${jobId}/results`, { taskId: item.taskId, nodeId: item.nodeId,
          leaseToken: item.leaseToken, result: item.result, computeMs: item.computeMs });
        if (outcome.accepted || outcome.duplicate || outcome.pendingVerification) { spool.delete(jobId, item.taskId); active.delete(item.taskId); }
        onEvent({ type: 'task-result', taskId: item.taskId, accepted: Boolean(outcome.accepted),
          verified: Boolean(outcome.verified), pendingVerification: Boolean(outcome.pendingVerification),
          duplicate: Boolean(outcome.duplicate), computeMs: +item.computeMs.toFixed(2), verification: outcome.verification ?? null });
      } catch (error) {
        // A 409 means this lease was fenced, expired, or already completed.
        // The authoritative coordinator has either reassigned or committed it.
        if (error.status === 409) { spool.delete(jobId, item.taskId); active.delete(item.taskId); }
        onEvent({ type: 'result-pending', taskId: item.taskId, message: error.message });
        if (!error.status) return false;
      }
    }
    return true;
  };
  try {
    const profile = benchmark();
    let unitsPerSecond = profile.unitsPerSecond;
    onEvent({ type: 'worker-start', nodeId, baseUrl, benchmark: profile, spoolFile });
    while (!signal.aborted) {
      const active = new Map(spool.list(jobId).map(item => [item.taskId, { taskId: item.taskId, leaseToken: item.leaseToken }]));
      await postSpooled(active);
      if (signal.aborted) break;
      let tasks;
      try { ({ tasks } = await request(`/jobs/${jobId}/work`, { nodeId, unitsPerSecond, targetSeconds })); }
      catch (error) {
        if (signal.aborted) break;
        onEvent({ type: 'poll-error', message: error.message }); await wait(pollMs); continue;
      }
      for (const task of tasks) active.set(task.id, { taskId: task.id, leaseToken: task.leaseToken });
      let renewing = false;
      const renew = async () => {
        if (renewing || !active.size || signal.aborted) return;
        renewing = true;
        try {
          const result = await request(`/jobs/${jobId}/leases/renew`, { nodeId, leases: [...active.values()] });
          for (const id of result.lost) active.delete(id);
          onEvent({ type: 'leases-renewed', count: result.renewed.length, lost: result.lost.length });
        } catch (error) { onEvent({ type: 'lease-renew-error', message: error.message }); }
        finally { renewing = false; }
      };
      const renewalTimer = tasks.length ? setInterval(renew, Math.max(1_000, Math.min(15_000, Math.floor(tasks[0].leaseMs / 3)))) : null;
      renewalTimer?.unref?.();
      try {
        for (const task of tasks) {
          try {
            const start = performance.now();
            const result = await compute(task.payload);
            const computeMs = performance.now() - start;
            unitsPerSecond = updateRateEstimate(unitsPerSecond, task.count, Math.max(computeMs, 0.01));
            onEvent({ type: 'capacity-update', nodeId, unitsPerSecond: +unitsPerSecond.toFixed(2) });
            spool.put({ jobId, taskId: task.id, nodeId, leaseToken: task.leaseToken, result, computeMs });
            await postSpooled(active);
          } catch (error) { active.delete(task.id); onEvent({ type: 'task-error', taskId: task.id, message: error.message }); }
        }
      } finally { if (renewalTimer) clearInterval(renewalTimer); }
      if (tasks.length === 0) {
        try {
          const job = await request(`/jobs/${jobId}`, undefined, 'GET');
          if (job.status !== 'running') { onEvent({ type: 'job-finished', jobId, status: job.status }); break; }
        } catch (error) { if (signal.aborted) break; onEvent({ type: 'status-error', message: error.message }); }
        await wait(pollMs);
      }
    }
  } finally {
    await computeWorker.terminate();
    spool.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [key, ...rest] = arg.replace(/^--/, '').split('='); return [key, rest.join('=')]; }));
  const jobId = args.job || process.env.MACN_JOB_ID;
  const controller = new AbortController();
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => controller.abort());
  runBatchWorker({ baseUrl: args.url || process.env.MACN_URL, token: args.token || process.env.MACN_TOKEN,
    nodeId: args.id || process.env.MACN_NODE_ID, jobId, targetSeconds: Number(args.window || process.env.MACN_WORK_WINDOW_SECONDS || 30),
    signal: controller.signal, onEvent: event => console.log(JSON.stringify({ at: new Date().toISOString(), ...event })) })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
