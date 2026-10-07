// Transport-independent adaptive scheduling policy. Rates are units per millisecond.
export class AdaptiveScheduler {
  constructor({ targetMs = 150, minChunk = 2000, maxChunk = 5000000, alpha = 0.35 } = {}) {
    Object.assign(this, { targetMs, minChunk, maxChunk, alpha });
  }
  chunk(node, remaining) {
    return Math.min(remaining, this.maxChunk, Math.max(this.minChunk, Math.floor(node.rate * this.targetMs)));
  }
  observe(node, count, elapsedMs) {
    const delivered = count / Math.max(1, elapsedMs);
    node.lastRate = delivered;
    node.rate = Math.max(0.001, (1 - this.alpha) * node.rate + this.alpha * delivered);
    node.slow = delivered < node.initialRate * 0.35;
  }
  leaseMs(node, count) {
    return Math.min(30000, Math.max(3000, 6 * count / node.rate + 4 * (node.rttMs || 0)));
  }
}
export function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
  return { samples: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}
