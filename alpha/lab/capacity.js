import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';
import { startServer } from '../src/server.js';
import { percentiles } from '../src/scheduler.js';
import { createPolicy } from '../src/policies.js';
import { coverage } from './simulate.js';
import { rangeWorkload } from './range-workload.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function withDeadline(promise, ms, stage) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(`Capacity probe ${stage} deadline exceeded`)), Math.max(1, ms));
  })]).finally(() => clearTimeout(timer));
}

// Real Socket.IO/WebSocket connections to one local coordinator. Worker work is
// deliberately O(1): this measures control-plane capacity, not compute power.
export async function capacityRun({ nodes = 10, samples = nodes * 1500000, seed = 42, deadlineMs = 120000, connectDeadlineMs = 120000 } = {}) {
  if (!Number.isInteger(nodes) || nodes < 1 || nodes > 5000) throw Error('capacity nodes: 1..5000');
  rangeWorkload.validate({ samples, seed });
  const clients = [], completionLatency = [], lag = monitorEventLoopDelay({ resolution: 10 });
  const app = await startServer({ port: 0, host: '127.0.0.1', quiet: true, saveReports: false, maxConnections: nodes + 1 });
  let measured = false, protocolMessages = 0, connectStarted = performance.now(), connected = 0, connectMs = null;
  try {
    for (let i = 0; i < nodes; i++) {
      const socket = io(`http://127.0.0.1:${app.port}`, { transports: ['websocket'], auth: { token: app.token, role: 'worker' }, reconnection: false });
      clients.push(socket);
      socket.onAny(() => { if (measured) protocolMessages++; });
      socket.onAnyOutgoing(() => { if (measured) protocolMessages++; });
      socket.on('ping-app', nonce => socket.emit('pong-app', nonce));
      socket.on('task', message => {
        const start = performance.now();
        const result = rangeWorkload.compute(message.task);
        socket.emit('result', { jobId: message.jobId, taskId: message.task.id, attempt: message.task.attempt,
          result, computeMs: performance.now() - start });
      });
      await withDeadline(new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      }), connectDeadlineMs - (performance.now() - connectStarted), 'connect');
      await withDeadline(new Promise((resolve, reject) => socket.emit('register', {
        name: `loopback-${i}`, benchmark: { workload: rangeWorkload.id, rate: 1000 }
      }, ack => ack?.ok ? resolve() : reject(Error(ack?.error || 'Registration failed')))),
      connectDeadlineMs - (performance.now() - connectStarted), 'registration');
      connected++;
    }
    connectMs = performance.now() - connectStarted;
    const engine = app.coordinator.engine;
    engine.scheduler = createPolicy('adaptive', { targetMs: 150, minChunk: 2000, maxChunk: 150000 });
    engine.log = event => { if (event.type === 'task-completed') completionLatency.push(event.elapsedMs); };
    const cpuStart = process.cpuUsage(), eluStart = performance.eventLoopUtilization();
    let peakRss = process.memoryUsage().rss;
    lag.enable(); measured = true;
    const started = performance.now();
    engine.start({ workloadId: rangeWorkload.id, params: { samples, seed } });
    while (engine.job.status === 'running') {
      await pause(10); peakRss = Math.max(peakRss, process.memoryUsage().rss);
      if (performance.now() - started > deadlineMs) engine.abort('Capacity probe deadline exceeded');
    }
    const elapsedMs = performance.now() - started;
    measured = false; lag.disable();
    const cpu = process.cpuUsage(cpuStart), elu = performance.eventLoopUtilization(eluStart);
    const snapshot = engine.snapshot(), expected = rangeWorkload.compute({ start: 0, count: samples, seed });
    const verified = engine.job.status === 'completed' && JSON.stringify(engine.job.result) === JSON.stringify(expected) && coverage(engine.job.tasks, samples);
    return {
      kind: 'real-loopback-websocket-control-plane', nodes, connected, samples, seed, verified,
      connectMs,
      elapsedMs, throughput: samples / elapsedMs * 1000,
      processCpuMs: (cpu.user + cpu.system) / 1000, coordinatorAndClientsEventLoopUtilization: elu.utilization,
      eventLoopDelayMs: { p50: lag.percentile(50) / 1e6, p95: lag.percentile(95) / 1e6, p99: lag.percentile(99) / 1e6 },
      taskRoundTripMs: percentiles(completionLatency), nodeRttMs: percentiles([...engine.nodes.values()].flatMap(n => n.rtts)),
      protocolMessages, taskCount: snapshot.job.created, completedUnits: snapshot.job.units,
      retries: snapshot.job.reassigned, duplicates: snapshot.job.duplicates,
      sampledPeakProcessRssBytes: peakRss, result: snapshot.job.result, expected,
      status: snapshot.job.status, error: snapshot.job.error,
      note: 'Real loopback Socket.IO/WebSocket connections to one coordinator; one local process also hosts test clients. O(1) checksum work, no physical devices and no GPU compute comparison. Measures connection/control-plane limits only.'
    };
  } finally {
    measured = false; lag.disable(); clients.forEach(socket => socket.disconnect()); await app.close();
  }
}
