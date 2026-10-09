import { randomUUID } from 'node:crypto';
import { workload as getWorkload } from './workloads.js';

// Batch delivery uses pull requests and bounded leases. Workload code remains
// pure and independent from transport and persistence.
export class BatchQueue {
  constructor(store, { leaseMs = 60_000, leaseSafetyMarginMs = 30_000, maxLeaseMs = 1_800_000, maxAttempts = 4, maxClaim = 32, now = Date.now } = {}) {
    this.store = store;
    this.leaseMs = leaseMs;
    this.leaseSafetyMarginMs = leaseSafetyMarginMs;
    this.maxLeaseMs = maxLeaseMs;
    this.maxAttempts = maxAttempts;
    this.maxClaim = maxClaim;
    this.now = now;
  }

  createJob({ workloadId, params, chunkSize = 10_000 }) {
    const w = getWorkload(workloadId);
    const validated = w.validate(params);
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 1_000_000) throw Error('chunkSize must be 1..1000000');
    const job = { id: randomUUID(), workloadId, params: validated, totalUnits: w.totalUnits(validated), chunkSize, createdAt: this.now() };
    this.store.createJob(job);
    return this.store.getJob(job.id);
  }

  claim({ jobId, nodeId, limit = 1, unitsPerSecond, targetSeconds = 30 }) {
    if (typeof nodeId !== 'string' || !/^[\w.-]{1,80}$/.test(nodeId)) throw Error('Invalid nodeId');
    if (!Number.isInteger(limit) || limit < 1 || limit > this.maxClaim) throw Error(`limit must be 1..${this.maxClaim}`);
    const now = this.now();
    const job = this.store.claimOverview(jobId, now);
    if (!job) return null;
    if (job.status !== 'running') return [];
    const w = getWorkload(job.workload_id);
    let claimLimit = limit, leaseMs = this.leaseMs;
    if (unitsPerSecond !== undefined) {
      if (!Number.isFinite(unitsPerSecond) || unitsPerSecond <= 0 || unitsPerSecond > 1e12) throw Error('unitsPerSecond must be in (0, 1e12]');
      if (!Number.isFinite(targetSeconds) || targetSeconds < 1 || targetSeconds > 300) throw Error('targetSeconds must be 1..300');
      claimLimit = Math.min(this.maxClaim, Math.max(1, Math.ceil(unitsPerSecond * targetSeconds / job.chunk_size)));
      // Lease the whole reserved package with margin. Tasks within a package
      // share expiry because the worker processes them in order.
      const expectedBatchMs = claimLimit * job.chunk_size / unitsPerSecond * 1_000;
      leaseMs = Math.min(this.maxLeaseMs, Math.max(leaseMs, Math.ceil(expectedBatchMs * 2 + this.leaseSafetyMarginMs)));
    }
    return this.store.claimTasks({ jobId, initial: job, nodeId, limit: claimLimit, leaseMs, maxAttempts: this.maxAttempts,
      now, makeTask: (start, count, params) => w.makeTask(start, count, params) });
  }

  submit({ jobId, taskId, nodeId, leaseToken, result, computeMs }) {
    const job = this.store.getJob(jobId);
    if (!job) return { accepted: false, reason: 'unknown-task' };
    const w = getWorkload(job.workloadId);
    return this.store.acceptResult({ jobId, taskId, nodeId, leaseToken, result, computeMs, now: this.now(),
      validateResult: w.validResult, mergeResults: w.merge });
  }

  renew({ jobId, nodeId, leases }) {
    if (typeof nodeId !== 'string' || !/^[\w.-]{1,80}$/.test(nodeId)) throw Error('Invalid nodeId');
    if (!Array.isArray(leases) || leases.length < 1 || leases.length > this.maxClaim) throw Error(`leases must contain 1..${this.maxClaim} entries`);
    const seen = new Set();
    for (const lease of leases) {
      if (!lease || typeof lease.taskId !== 'string' || typeof lease.leaseToken !== 'string' || seen.has(lease.taskId)) throw Error('Invalid or duplicate lease');
      seen.add(lease.taskId);
    }
    const job = this.store.getJob(jobId);
    if (!job) return null;
    return this.store.renewTasks({ jobId, nodeId, leases, now: this.now(), leaseMs: this.leaseMs });
  }

  getJob(id) { return this.store.getJob(id); }
  close() { this.store.close(); }
}
