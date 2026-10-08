import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';
import { startServer } from '../src/server.js';
import { createPolicy } from '../src/policies.js';
import { monteCarlo } from '../src/workloads.js';
import { percentiles } from '../src/scheduler.js';
import { coverage } from './simulate.js';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function realRun({ nodes = 10, samples = nodes * 5000000, seed = 42, scenario = 'steady', policy = 'adaptive', deadlineMs = 60000, calibrationRates, emulatedHeterogeneity = true } = {}) {
  if (!Number.isInteger(nodes) || nodes < 1 || nodes > 50) throw Error('real nodes: 1..50');
  if (!['steady', 'slowdown', 'churn'].includes(scenario)) throw Error('Real scenario: steady, slowdown, churn');
  monteCarlo.validate({ samples, seed });
  const workers = [], clients = [], pendingTimers = new Set(), calibration = [], taskRoundTrips = [];
  const lag = monitorEventLoopDelay({ resolution: 10 });
  const runStarted = performance.now();
  const app = await startServer({ port: 0, host: '127.0.0.1', quiet: true, saveReports: false,
    onEvent: entry => { if (entry.type === 'task-completed') taskRoundTrips.push(entry.elapsedMs); } });
  let started = 0, running = false, dropped = 0, injectedDuplicates = 0, protocolMessages = 0;
  const later = (fn, ms) => { const timer = setTimeout(() => { pendingTimers.delete(timer); fn(); }, ms); pendingTimers.add(timer); return timer; };
  try {
    // Limit simultaneous initialization bursts; each node still has its own
    // compute thread and real WebSocket connection during the measured job.
    for (let i = 0; i < nodes; i++) {
      const thread = new Worker(new URL('./compute-thread.js', import.meta.url), { execArgv: [] }); workers.push(thread);
      const [ready] = await once(thread, 'message');
      const factor = emulatedHeterogeneity ? [1, 2, 4, 8][i % 4] : 1;
      const bench = { ...ready.benchmark, rate: (calibrationRates?.[i] ?? ready.benchmark.rate) / factor };
      calibration.push({ node: i, measuredRate: ready.benchmark.rate, injectedInitialDelayFactor: factor, effectiveRate: bench.rate });
      const socket = io(`http://127.0.0.1:${app.port}`, { transports: ['websocket'], auth: { token: app.token, role: 'worker' }, reconnection: false }); clients.push(socket);
      socket.onAny(() => { if (running) protocolMessages++; });
      socket.onAnyOutgoing(() => { if (running) protocolMessages++; });
      let active = null, droppedHere = false;
      socket.on('ping-app', nonce => socket.emit('pong-app', nonce));
      socket.on('task', message => { active = message; thread.postMessage(message); });
      socket.on('cancel', message => {
        if (active?.jobId === message.jobId && active.task.id === message.taskId) active = null;
      });
      thread.on('message', data => {
        if (data.type !== 'result' || !running) return;
        const sameLease = () => active?.jobId === data.jobId && active.task.id === data.task.id && active.task.attempt === data.task.attempt;
        const slow = scenario === 'slowdown' && i % 4 === 0 && performance.now() - started >= 50 ? 20 : 1;
        const extraMs = data.computeMs * (factor * slow - 1) + (emulatedHeterogeneity ? 4 : 0);
        const deliver = () => {
          if (!sameLease() || !socket.connected) return;
          active = null;
          if (scenario === 'churn' && i % 10 === 1 && !droppedHere) { droppedHere = true; dropped++; return; }
          const result = { jobId: data.jobId, taskId: data.task.id, attempt: data.task.attempt, result: data.result, computeMs: data.computeMs };
          socket.emit('result', result);
          if (scenario === 'churn' && i % 10 === 2) { socket.emit('result', result); injectedDuplicates++; }
        };
        if (extraMs > 0) later(deliver, extraMs); else deliver();
      });
      await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
      await new Promise((resolve, reject) => socket.emit('register', { name: `thread-${i}`, benchmark: bench }, ack => ack.ok ? resolve() : reject(Error(ack.error))));
    }
    const engine = app.coordinator.engine;
    engine.scheduler = createPolicy(policy, { maxChunk: 500000 });
    const cpuStart = process.cpuUsage(), eluStart = performance.eventLoopUtilization();
    let peakRss = process.memoryUsage().rss;
    lag.enable(); running = true; started = performance.now();
    engine.start({ params: { samples, seed } });
    if (scenario === 'churn') later(() => {
      for (let i = 0; i < nodes; i += 10) clients[i].disconnect();
    }, 100);
    while (engine.job.status === 'running') {
      await pause(20); peakRss = Math.max(peakRss, process.memoryUsage().rss);
      if (performance.now() - started > deadlineMs) engine.abort('Real lab deadline exceeded');
    }
    running = false; lag.disable();
    const cpu = process.cpuUsage(cpuStart), elu = performance.eventLoopUtilization(eluStart), snapshot = engine.snapshot();
    // Reference computation is outside the distributed measurement interval.
    const referenceStart = performance.now(), expected = monteCarlo.compute({ start: 0, count: samples, seed });
    const referenceComputeMs = performance.now() - referenceStart;
    const verified = engine.job.status === 'completed' && engine.job.result.hits === expected.hits && engine.job.result.count === samples && coverage(engine.job.tasks, samples);
    return { kind: 'real-local-worker-threads-and-websockets', policy, scenario, nodes, samples, seed, verified,
      elapsedMs: snapshot.job.elapsedMs, throughput: snapshot.job.throughput,
      processCpuMs: (cpu.user + cpu.system) / 1000, coordinatorEventLoopUtilization: elu.utilization,
      eventLoopDelayMs: { p50: lag.percentile(50) / 1e6, p95: lag.percentile(95) / 1e6, p99: lag.percentile(99) / 1e6 },
      sampledPeakProcessRssBytes: peakRss, contributors: snapshot.nodes.filter(n => n.completed).length,
      protocolMessages, latencyRttMs: percentiles([...engine.nodes.values()].flatMap(n => n.rtts)),
      taskRoundTripMs: percentiles(taskRoundTrips), setupMs: started - runStarted,
      measuredWallMs: performance.now() - runStarted, emulatedHeterogeneity,
      retries: snapshot.job.reassigned, duplicates: snapshot.job.duplicates, injectedDroppedResults: dropped, injectedDuplicates,
      taskCount: snapshot.job.created, completedUnits: snapshot.job.units, result: snapshot.job.result, expected, referenceComputeMs,
      calibration, status: snapshot.job.status, error: snapshot.job.error,
      note: 'Actual Monte Carlo in one worker thread per node and real loopback WebSockets, all on ONE host. Synthetic service delays model heterogeneity. Reference kernel timing is correctness-only, not a comparable speedup baseline.' };
  } finally {
    running = false; lag.disable(); for (const timer of pendingTimers) clearTimeout(timer);
    clients.forEach(socket => socket.disconnect()); await Promise.all(workers.map(worker => worker.terminate())); await app.close();
  }
}
