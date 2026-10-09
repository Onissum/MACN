import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
};

// CPU-heavy trusted checks run away from the HTTP/SQLite event loop. The
// bounded queue protects the coordinator from an unbounded verification load.
export class BatchVerifierPool {
  constructor({ size = 1, maxQueue = 512, onEvent = () => {} } = {}) {
    if (!Number.isInteger(size) || size < 1 || size > 16) throw Error('verifier size must be 1..16');
    if (!Number.isInteger(maxQueue) || maxQueue < size || maxQueue > 100_000) throw Error('verifier maxQueue must be size..100000');
    this.size = size;
    this.maxQueue = maxQueue;
    this.onEvent = onEvent;
    this.nextId = 0;
    this.queue = [];
    this.slots = new Set();
    this.closed = false;
    this.completed = 0;
    this.failed = 0;
    this.totalComputeMs = 0;
    this.totalQueueWaitMs = 0;
    this.totalElapsedMs = 0;
    this.samples = [];
    for (let i = 0; i < size; i++) this.spawn();
  }

  spawn() {
    if (this.closed) return;
    const slot = { worker: new Worker(new URL('./batch-verifier-thread.js', import.meta.url)), active: null, stopping: false };
    this.slots.add(slot);
    slot.worker.on('message', message => this.onMessage(slot, message));
    slot.worker.on('error', error => this.onFailure(slot, error));
    slot.worker.on('exit', code => {
      this.slots.delete(slot);
      if (!slot.stopping && !this.closed) this.onFailure(slot, Error(`Verifier thread exited with code ${code}`));
    });
    this.dispatch();
  }

  verify({ workloadId, task, result }) {
    if (this.closed) return Promise.reject(Error('Verifier pool is closed'));
    if (this.queue.length >= this.maxQueue) {
      this.failed++;
      const error = Error('Verifier queue is full'); error.code = 'VERIFIER_BUSY';
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ id: ++this.nextId, workloadId, task, result, queuedAt: performance.now(), resolve, reject });
      this.dispatch();
    });
  }

  dispatch() {
    if (this.closed || !this.queue.length) return;
    for (const slot of this.slots) {
      if (slot.active || slot.stopping) continue;
      const entry = this.queue.shift();
      if (!entry) break;
      entry.startedAt = performance.now();
      slot.active = entry;
      try { slot.worker.postMessage({ id: entry.id, workloadId: entry.workloadId, task: entry.task, result: entry.result }); }
      catch (error) { slot.active = null; entry.reject(error); this.failed++; }
    }
  }

  onMessage(slot, message) {
    const entry = slot.active;
    if (!entry || message.id !== entry.id) return;
    slot.active = null;
    const finishedAt = performance.now();
    const queueWaitMs = Math.max(0, entry.startedAt - entry.queuedAt);
    const elapsedMs = Math.max(0, finishedAt - entry.queuedAt);
    if (message.error) {
      this.failed++;
      entry.reject(Error(message.error));
    } else {
      const verificationMs = Number(message.verification?.verificationMs) || 0;
      this.completed++;
      this.totalComputeMs += verificationMs;
      this.totalQueueWaitMs += queueWaitMs;
      this.totalElapsedMs += elapsedMs;
      this.samples.push({ queueWaitMs, verificationMs, elapsedMs });
      if (this.samples.length > 2048) this.samples.shift();
      entry.resolve({ ...message.verification, queueWaitMs, elapsedMs });
    }
    this.dispatch();
  }

  onFailure(slot, error) {
    if (slot.stopping || this.closed) return;
    slot.stopping = true;
    if (slot.active) {
      const active = slot.active; slot.active = null;
      this.failed++;
      active.reject(error);
    }
    try { slot.worker.terminate(); } catch {}
    this.slots.delete(slot);
    this.onEvent({ type: 'verifier-thread-failed', message: error.message });
    this.dispatch();
    if (!this.closed) this.spawn();
  }

  snapshot() {
    const samples = this.samples;
    return {
      workers: this.size,
      active: [...this.slots].filter(slot => slot.active).length,
      queued: this.queue.length,
      maxQueue: this.maxQueue,
      completed: this.completed,
      failed: this.failed,
      totalComputeMs: +this.totalComputeMs.toFixed(3),
      totalQueueWaitMs: +this.totalQueueWaitMs.toFixed(3),
      totalElapsedMs: +this.totalElapsedMs.toFixed(3),
      recentSamples: samples.length,
      recent: {
        queueWaitP50Ms: percentile(samples.map(item => item.queueWaitMs), 0.50),
        queueWaitP95Ms: percentile(samples.map(item => item.queueWaitMs), 0.95),
        queueWaitP99Ms: percentile(samples.map(item => item.queueWaitMs), 0.99),
        computeP50Ms: percentile(samples.map(item => item.verificationMs), 0.50),
        computeP95Ms: percentile(samples.map(item => item.verificationMs), 0.95),
        computeP99Ms: percentile(samples.map(item => item.verificationMs), 0.99),
        endToEndP50Ms: percentile(samples.map(item => item.elapsedMs), 0.50),
        endToEndP95Ms: percentile(samples.map(item => item.elapsedMs), 0.95),
        endToEndP99Ms: percentile(samples.map(item => item.elapsedMs), 0.99)
      }
    };
  }

  async close() {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.stop();
    return this.closePromise;
  }

  async stop() {
    this.closed = true;
    const error = Error('Verifier pool closed before task completed');
    for (const entry of this.queue.splice(0)) entry.reject(error);
    const workers = [...this.slots];
    for (const slot of workers) {
      slot.stopping = true;
      if (slot.active) { slot.active.reject(error); slot.active = null; }
    }
    await Promise.all(workers.map(slot => slot.worker.terminate()));
    this.slots.clear();
  }
}
