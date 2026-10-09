import { simulate, scenarios as availableScenarios } from './simulate.js';
import { policyNames } from '../src/policies.js';

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function breakEvenRun({ nodes = [1, 4, 16, 64], samples = 10_000_000, seed = 42, repeats = 3,
  dataBytesPerUnit = [0, 64, 1024], computeMultipliers = [1, 20], scenarios = ['steady', 'latency'] } = {}) {
  if (!Array.isArray(nodes) || !nodes.length || nodes.some(n => !Number.isInteger(n) || n < 1 || n > 10000)) throw Error('nodes must be integers: 1..10000');
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw Error('repeats: 1..10');
  if (!Array.isArray(dataBytesPerUnit) || !dataBytesPerUnit.length || dataBytesPerUnit.some(n => !Number.isFinite(n) || n < 0 || n > 1e9)) throw Error('Invalid dataBytesPerUnit');
  if (!Array.isArray(computeMultipliers) || !computeMultipliers.length || computeMultipliers.some(n => !Number.isFinite(n) || n <= 0 || n > 1e6)) throw Error('Invalid computeMultipliers');
  if (!Array.isArray(scenarios) || !scenarios.length || scenarios.some(s => !availableScenarios.includes(s))) throw Error('Invalid scenarios');

  const runs = [];
  for (const scenario of scenarios) for (const count of nodes) for (const bytes of dataBytesPerUnit) {
    for (const computeMultiplier of computeMultipliers) for (let repeat = 0; repeat < repeats; repeat++) {
      // All policies in a pair see identical node/network profiles.
      for (const policy of policyNames) {
        const deadlineMs = Math.max(120000, 2 * (samples / 60 * computeMultiplier + samples * bytes * 0.0014 + 10000));
        const run = simulate({ nodes: count, samples, seed: seed + repeat, scenario, policy,
          dataBytesPerUnit: bytes, computeMultiplier, deadlineMs });
        runs.push({ repeat: repeat + 1, ...run });
      }
    }
  }

  const groups = new Map();
  for (const run of runs) {
    const key = [run.scenario, run.nodes, run.dataBytesPerUnit, run.computeMultiplier].join('/');
    if (!groups.has(key)) groups.set(key, { scenario: run.scenario, nodes: run.nodes,
      dataBytesPerUnit: run.dataBytesPerUnit, computeMultiplier: run.computeMultiplier, policies: {} });
    (groups.get(key).policies[run.policy] ||= []).push(run);
  }
  const summary = [...groups.values()].map(group => {
    const policies = Object.fromEntries(Object.entries(group.policies).map(([name, values]) => [name, {
      medianBaselineMs: median(values.map(v => v.singleNodeMs)),
      medianMs: median(values.filter(v => v.verified).map(v => v.modelledMs)),
      medianSpeedup: median(values.filter(v => v.verified).map(v => v.speedup)),
      medianEfficiency: median(values.filter(v => v.verified).map(v => v.parallelEfficiency)),
      medianTransferredMiB: median(values.map(v => (v.inputBytesSent + v.outputBytesSent) / 1048576)), verified: values.every(v => v.verified)
    }]));
    return { ...group, policies };
  });
  for (const group of summary) {
    const key = [group.scenario, group.dataBytesPerUnit, group.computeMultiplier].join('/');
    const sizes = summary.filter(other => [other.scenario, other.dataBytesPerUnit, other.computeMultiplier].join('/') === key &&
      other.policies.adaptive.verified && other.policies.adaptive.medianSpeedup >= 1).map(other => other.nodes);
    group.breakEvenNodes = sizes.length ? Math.min(...sizes) : null;
  }
  return { kind: 'simulated-break-even-matrix', samples, seed, repeats, policies: policyNames,
    nodes, dataBytesPerUnit, computeMultipliers, scenarios, summary, runs,
    note: 'Discrete-event model only. Synthetic per-node rates, RTT and bandwidth; baseline is fastest simulated node with local data. Coordinator saturation is not charged to virtual job time, so speedup may be optimistic. Not a measurement of real devices, Internet links or GPU performance.' };
}
