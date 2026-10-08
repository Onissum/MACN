import { performance } from 'node:perf_hooks';
import { monteCarlo } from '../src/workloads.js';
import { realRun } from './real.js';
import { median } from './report.js';

const sameResult = (a, b) => a?.count === b?.count && a?.hits === b?.hits;

export function summarizeComparison(runs) {
  const baselineByRepeat = new Map(runs.filter(run => run.topology === 'sequential').map(run => [run.repeat, run]));
  const keys = [...new Set(runs.filter(run => run.topology !== 'sequential').map(run => `${run.topology}/${run.nodes}`))];
  return keys.map(key => {
    const [topology, nodeText] = key.split('/'), nodes = Number(nodeText);
    const group = runs.filter(run => run.topology === topology && run.nodes === nodes);
    const paired = group.map(run => {
      const baseline = baselineByRepeat.get(run.repeat);
      return baseline && run.verified && baseline.verified ? {
        jobSpeedup: baseline.elapsedMs / run.elapsedMs,
        endToEndSpeedup: baseline.elapsedMs / (run.setupMs + run.elapsedMs)
      } : null;
    }).filter(Boolean);
    return {
      topology, nodes, repeats: group.length,
      medianJobMs: median(group.map(run => run.elapsedMs)),
      medianSetupMs: median(group.map(run => run.setupMs)),
      medianThroughput: median(group.map(run => run.throughput)),
      medianJobSpeedup: median(paired.map(pair => pair.jobSpeedup)),
      medianEndToEndSpeedup: median(paired.map(pair => pair.endToEndSpeedup)),
      medianEfficiency: nodes > 0 ? median(paired.map(pair => pair.jobSpeedup / nodes)) : null,
      verified: group.length > 0 && group.every(run => run.verified) && paired.length === group.length
    };
  });
}

export async function compareRun({ nodes = [1, 2, 4], samples = 50_000_000, seed = 42, repeats = 3, deadlineMs = 60000, onRun = () => {} } = {}) {
  if (!Array.isArray(nodes) || nodes.length < 1 || nodes.some(n => !Number.isInteger(n) || n < 1 || n > 50) || new Set(nodes).size !== nodes.length) {
    throw Error('Comparison worker counts must be unique integers from 1 to 50');
  }
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10 || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff - repeats) {
    throw Error('Invalid comparison repeats/seed');
  }
  monteCarlo.validate({ samples, seed });

  // Warm the sequential kernel before collecting the official samples.
  monteCarlo.compute({ start: 0, count: Math.min(samples, 250_000), seed });
  const runs = [];
  const workers = nodes.map(n => ({ topology: 'macn-workers', nodes: n }));
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const pairedSeed = seed + repeat - 1;
    const reference = monteCarlo.compute({ start: 0, count: samples, seed: pairedSeed });
    // Rotate execution order across worker counts to reduce thermal/JIT bias.
    const offset = (repeat - 1) % workers.length;
    const order = [...workers.slice(offset), ...workers.slice(0, offset)];
    const baselineFirst = repeat % 2 === 1;
    const sequence = baselineFirst ? ['sequential', ...order] : [...order, 'sequential'];
    for (const item of sequence) {
      if (item === 'sequential') {
        const started = performance.now();
        const result = monteCarlo.compute({ start: 0, count: samples, seed: pairedSeed });
        const elapsedMs = performance.now() - started;
        const run = { repeat, seed: pairedSeed, topology: 'sequential', nodes: 1, elapsedMs,
          setupMs: 0, throughput: samples / Math.max(elapsedMs, 0.001) * 1000,
          result, verified: sameResult(reference, result), taskRoundTripMs: { p50: null, p95: null, p99: null } };
        runs.push(run); await onRun(run);
        continue;
      }
      const topology = item;
      const measured = await realRun({ nodes: topology.nodes, samples, seed: pairedSeed,
        scenario: 'steady', policy: 'adaptive', deadlineMs, emulatedHeterogeneity: false });
      const result = measured.result;
      const run = { repeat, seed: pairedSeed, topology: 'macn-workers', nodes: topology.nodes,
        elapsedMs: measured.elapsedMs, setupMs: measured.setupMs,
        throughput: measured.throughput, processCpuMs: measured.processCpuMs,
        coordinatorEventLoopUtilization: measured.coordinatorEventLoopUtilization,
        coordinatorEventLoopDelayMs: measured.eventLoopDelayMs,
        heartbeatRttMs: measured.latencyRttMs, taskRoundTripMs: measured.taskRoundTripMs,
        retries: measured.retries, duplicates: measured.duplicates, contributors: measured.contributors,
        taskCount: measured.taskCount, result, verified: measured.verified && sameResult(reference, result),
        workers: measured.calibration.map(({ node, measuredRate }) => ({ node, measuredRate })) };
      runs.push(run); await onRun(run);
      if (!run.verified) throw Error(`Result mismatch at repeat ${repeat}, ${topology.nodes} workers`);
    }
  }
  return { kind: 'monte-carlo-comparison', workload: monteCarlo.id, samples, seed, requestedWorkers: nodes,
    repeats, physicalHosts: 1, verified: runs.every(run => run.verified), runs,
    summary: summarizeComparison(runs),
    note: 'Sequential kernel versus MACN coordinator with local worker threads and loopback WebSockets on ONE host. Job speedup excludes worker/server startup; end-to-end speedup includes measured setup. Not a physical-device or GPU comparison.' };
}
