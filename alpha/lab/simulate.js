import { performance } from 'node:perf_hooks';
import { TaskEngine } from '../src/engine.js';
import { createPolicy } from '../src/policies.js';
import { rangeWorkload } from './range-workload.js';
import { Events, rng } from './events.js';

export const scenarios = ['steady', 'slowdown', 'churn', 'latency'];
export function profiles(count, seed, scenario) {
  if (!scenarios.includes(scenario)) throw Error('Unknown scenario: ' + scenario);
  const random = rng(seed);
  return Array.from({ length: count }, (_, i) => ({ id: `node-${i}`, rate: [600, 300, 120, 60][i % 4],
    rtt: scenario === 'latency' ? 80 + Math.floor(random() * 160) : 4 + Math.floor(random() * 12),
    downMbps: [80, 40, 20, 10][i % 4], uploadMbps: [30, 15, 8, 4][i % 4],
    slowAt: scenario === 'slowdown' && i % 4 === 0 ? 300 : Infinity,
    factor: scenario === 'slowdown' && i % 4 === 0 ? 0.08 : 1,
    lostAt: scenario === 'churn' && i % 10 === 0 ? 600 : Infinity,
    silent: i % 20 === 0, dropFirst: scenario === 'churn' && i % 10 === 1,
    duplicate: scenario === 'churn' && i % 10 === 2, alive: true, dropped: false }));
}
function serviceMs(p, start, count) {
  const before = Math.max(0, p.slowAt - start) * p.rate;
  return count <= before ? count / p.rate : Math.max(0, p.slowAt - start) + (count - before) / (p.rate * p.factor);
}
export function coverage(tasks, total) {
  let cursor = 0;
  for (const task of [...tasks.values()].sort((a, b) => a.payload.start - b.payload.start)) {
    if (task.status !== 'done' || task.payload.start !== cursor) return false;
    cursor += task.count;
  }
  return cursor === total;
}
export function simulate({ nodes = 100, samples = nodes * 1000000, seed = 42, scenario = 'steady', policy = 'adaptive', deadlineMs = 120000,
  dataBytesPerUnit = 0, computeMultiplier = 1 } = {}) {
  if (!Number.isInteger(nodes) || nodes < 1 || nodes > 10000) throw Error('nodes: 1..10000');
  if (!Number.isFinite(dataBytesPerUnit) || dataBytesPerUnit < 0 || dataBytesPerUnit > 1e9) throw Error('dataBytesPerUnit: 0..1e9');
  if (!Number.isFinite(computeMultiplier) || computeMultiplier <= 0 || computeMultiplier > 1e6) throw Error('computeMultiplier: >0..1e6');
  rangeWorkload.validate({ samples, seed });
  const startWall = performance.now(), startCpu = process.cpuUsage(), events = new Events();
  let now = 0, handled = 0, messages = 0, peakQueue = 0, peakRss = process.memoryUsage().rss, dispatchMs = 0, maxDispatchMs = 0, dispatchCalls = 0;
  let inputBytesSent = 0, outputBytesSent = 0, transferMsAccumulated = 0;
  const peers = profiles(nodes, seed, scenario), byId = new Map(peers.map(p => [p.id, p]));
  const engine = new TaskEngine({ now: () => now, scheduler: createPolicy(policy),
    send(id, type, m) {
      messages++;
      const p = byId.get(id);
      if (!p.alive) return false;
      if (type !== 'task') return true;
      // A simple store-and-forward model: half RTT + input transfer, compute,
      // half RTT + result transfer. Rates are per-node link estimates.
      const inputBytes = 256 + m.task.count * dataBytesPerUnit / 2;
      const outputBytes = 64 + m.task.count * dataBytesPerUnit / 2;
      const inputMs = inputBytes * 8 / (p.downMbps * 1000), outputMs = outputBytes * 8 / (p.uploadMbps * 1000);
      inputBytesSent += inputBytes; outputBytesSent += outputBytes; transferMsAccumulated += inputMs + outputMs;
      const computeStart = now + p.rtt / 2 + inputMs;
      const duration = serviceMs(p, computeStart, m.task.count) * computeMultiplier;
      events.push(computeStart + duration + p.rtt / 2 + outputMs, () => {
        if (!p.alive) return;
        if (p.dropFirst && !p.dropped) { p.dropped = true; return; }
        const reply = { jobId: m.jobId, taskId: m.task.id, attempt: m.task.attempt,
          result: rangeWorkload.compute(m.task), computeMs: duration };
        messages++; // Delivered result, in addition to the outbound task.
        engine.accept(id, reply);
        if (p.duplicate) { messages++; engine.accept(id, reply); }
      });
      return true;
    }
  });
  const dispatch = engine.dispatch.bind(engine);
  engine.dispatch = (...args) => {
    const t = performance.now();
    try { return dispatch(...args); }
    finally { const elapsed = performance.now() - t; dispatchMs += elapsed; maxDispatchMs = Math.max(maxDispatchMs, elapsed); dispatchCalls++; }
  };
  for (const p of peers) {
    // Capacity calibration is workload-specific: slower compute per unit must
    // be reflected in the rate used by scheduling and lease estimates.
    engine.addNode(p.id, p.id, { workload: rangeWorkload.id, rate: p.rate / computeMultiplier });
    if (Number.isFinite(p.lostAt)) events.push(p.lostAt, () => { p.alive = false; if (!p.silent) engine.removeNode(p.id); });
  }
  function pulse() {
    for (const p of peers) if (p.alive) { messages += 2; engine.heartbeat(p.id, p.rtt); }
    engine.tick();
    // This model has no future reconnect events. Stop instead of advancing a
    // forever-paused job after its entire simulated population has vanished.
    if (engine.job?.status === 'running' && !peers.some(p => p.alive)) engine.abort('No simulated nodes remain');
    if (engine.job?.status === 'running') events.push(now + 500, pulse);
  }
  engine.start({ workloadId: rangeWorkload.id, params: { samples, seed } });
  events.push(0, pulse);
  while (engine.job.status === 'running' && events.size) {
    peakQueue = Math.max(peakQueue, events.size);
    const event = events.pop(); now = event.at;
    if (now > deadlineMs) { engine.abort('Simulation deadline exceeded'); break; }
    event.fn(); handled++;
    if (handled % 100 === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss);
    if (handled > 2000000) { engine.abort('Event budget exceeded'); break; }
  }
  const snapshot = engine.snapshot(), expected = rangeWorkload.compute({ start: 0, count: samples, seed });
  const reference = [...peers].sort((a, b) => b.rate - a.rate)[0];
  const singleNodeMs = serviceMs(reference, 0, samples) * computeMultiplier;
  const verified = engine.job.status === 'completed' && JSON.stringify(engine.job.result) === JSON.stringify(expected) && coverage(engine.job.tasks, samples);
  const speedup = verified ? singleNodeMs / snapshot.job.elapsedMs : null;
  const cpu = process.cpuUsage(startCpu);
  return { kind: 'discrete-event-simulation', nodes, samples, seed, scenario, policy, dataBytesPerUnit, computeMultiplier, verified,
    modelledMs: snapshot.job.elapsedMs, singleNodeMs, speedup,
    parallelEfficiency: speedup === null ? null : speedup / nodes,
    inputBytesSent, outputBytesSent, transferMsAccumulated,
    wallMs: performance.now() - startWall, cpuMs: (cpu.user + cpu.system) / 1000,
    dispatchMs, maxDispatchMs, dispatchCalls, events: handled, protocolMessages: messages, peakEventQueue: peakQueue,
    sampledPeakProcessRssBytes: Math.max(peakRss, process.memoryUsage().rss),
    taskCount: snapshot.job.created, retries: snapshot.job.reassigned, duplicates: snapshot.job.duplicates,
    rejected: snapshot.job.rejected, contributors: snapshot.nodes.filter(n => n.completed).length,
    result: snapshot.job.result, expected, status: snapshot.job.status, error: snapshot.job.error,
    note: 'Virtual node rates, RTT, bandwidth, data transfer and completion time. Coordinator saturation is not charged to virtual job time, so speedup can be optimistic. Baseline is the fastest simulated node with local data. O(1) checksum fixture; not a physical-cluster or GPU measurement. Wall/CPU/RSS describe this host and include simulation overhead.' };
}
