import { AdaptiveScheduler } from './scheduler.js';

// Fixed ownership of contiguous ranges, with exact integer coverage. Recovery
// remains the engine's responsibility and is identical for every policy.
export function partition(nodes, total, weight) {
  let remaining = total;
  let remainingWeight = nodes.reduce((sum, node) => sum + weight(node), 0);
  const ranges = new Map();
  for (const [index, node] of nodes.entries()) {
    const w = weight(node);
    const count = index === nodes.length - 1 ? remaining : Math.min(remaining, Math.floor(remaining * w / remainingWeight));
    ranges.set(node.id, { start: total - remaining, end: total - remaining + count });
    remaining -= count; remainingWeight -= w;
  }
  return ranges;
}
class FixedScheduler extends AdaptiveScheduler {
  chunk(node, remaining) {
    return Math.min(remaining, this.maxChunk, Math.max(this.minChunk, Math.floor(node.initialRate * this.targetMs)));
  }
  observe(node, count, elapsedMs) {
    node.lastRate = count / Math.max(1, elapsedMs);
    node.slow = node.lastRate < node.initialRate * 0.35;
  }
  penalize() {} // Keep the initial estimate, by definition of the baseline.
}
export class EqualScheduler extends FixedScheduler {
  name = 'equal';
  allocations(nodes, total) { return partition(nodes, total, () => 1); }
}
export class CalibratedScheduler extends FixedScheduler {
  name = 'calibrated';
  allocations(nodes, total) { return partition(nodes, total, n => n.initialRate); }
}
export const policyNames = ['equal', 'calibrated', 'adaptive'];
export function createPolicy(name, options = {}) {
  if (name === 'equal') return new EqualScheduler(options);
  if (name === 'calibrated') return new CalibratedScheduler(options);
  if (name === 'adaptive') return new AdaptiveScheduler(options);
  throw Error('Unknown scheduling policy: ' + name);
}
