import { AdaptiveScheduler, percentiles } from './scheduler.js';
import { workload } from './workloads.js';

export class TaskEngine {
  constructor({ now = () => performance.now(), send = () => true, log = () => {}, scheduler = new AdaptiveScheduler(), heartbeatMs = 8000, maxAttempts = 8, autoDispatch = true, jobPrefix = 'job' } = {}) {
    Object.assign(this, { now, send, log, scheduler, heartbeatMs, maxAttempts, autoDispatch, jobPrefix });
    this.nodes = new Map(); this.job = null; this.sequence = 0;
  }
  event(type, details = {}) { this.log({ at: this.now(), type, ...details }); }
  addNode(id, name, bench) {
    if (!bench || !Number.isFinite(bench.rate) || bench.rate <= 0 || bench.rate > 1e8) throw Error('Invalid benchmark');
    workload(bench.workload);
    if (this.nodes.has(id)) throw Error('Node already registered');
    this.nodes.set(id, { id, workloadId: bench.workload, name: String(name || id).slice(0, 60), rate: bench.rate, initialRate: bench.rate,
      connected: true, lastSeen: this.now(), busy: null, assigned: 0, completed: 0, units: 0,
      computeMs: 0, reassigned: 0, slow: false, rtts: [], rttMs: null, cooldown: 0 });
    this.event('node-ready', { id }); this.dispatch();
  }
  heartbeat(id, rtt) {
    const n = this.nodes.get(id); if (!n || !n.connected) return;
    n.lastSeen = this.now();
    if (Number.isFinite(rtt) && rtt >= 0) { n.rttMs = rtt; n.rtts.push(rtt); if (n.rtts.length > 600) n.rtts.shift(); }
  }
  removeNode(id, reason = 'disconnected') {
    const n = this.nodes.get(id); if (!n || !n.connected) return;
    n.connected = false;
    const range = this.job?.allocations?.get(id);
    if (range && range.start < range.end) { this.job.orphans.push({ ...range }); range.start = range.end; }
    this.requeue(n, reason); this.event('node-lost', { id, reason }); this.dispatch();
  }
  start({ workloadId = 'monte-carlo-v1', params, nodeIds, mode = 'distributed' }) {
    if (this.job?.status === 'running') throw Error('Job already running');
    const w = workload(workloadId); params = w.validate(params);
    const ids = nodeIds || [...this.nodes.values()].filter(n => n.connected).map(n => n.id);
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !this.nodes.get(id)?.connected || this.nodes.get(id).workloadId !== workloadId)) throw Error('Select connected nodes');
    for (const n of this.nodes.values()) { n.busy = null; n.assigned = n.completed = n.units = n.computeMs = n.reassigned = 0; n.cooldown = 0; }
    this.job = { id: `${this.jobPrefix}-${++this.sequence}`, workloadId, params, totalUnits: w.totalUnits(params), mode, nodeIds: ids, status: 'running', started: this.now(),
      allocations: this.scheduler.allocations?.(ids.map(id => this.nodes.get(id)), w.totalUnits(params)) || null, orphans: [],
      ended: null, next: 0, tasks: new Map(), pending: [], completed: 0, units: 0, reassigned: 0, duplicates: 0, rejected: 0, result: null };
    this.event('job-start', { jobId: this.job.id, mode, params }); this.dispatch(); return this.job.id;
  }
  dispatch({ force = false, limit = Infinity, eligible = () => true } = {}) {
    if (!this.autoDispatch && !force) return 0;
    const j = this.job; if (!j || j.status !== 'running') return 0;
    // Build this list once per dispatch, rather than rescanning all peers for
    // every assignment (the alpha.1 initial dispatch was quadratic).
    const idle = j.nodeIds.map(id => this.nodes.get(id)).filter(n =>
      n?.connected && !n.busy && n.cooldown <= this.now() && eligible(n.id));
    let idleRate = idle.reduce((sum, n) => sum + n.rate, 0), assigned = 0;
    for (const n of idle) {
      const id = n.id;
      if (assigned >= limit) break;
      let t = j.pending.shift();
      if (!t) {
        const orphan = j.orphans[0];
        const range = orphan || j.allocations?.get(id);
        const start = range ? range.start : j.next;
        const end = range ? range.end : j.allocations ? start : j.totalUnits;
        const remaining = end - start;
        if (remaining > 0) {
          const budget = range ? remaining : Math.max(1, Math.floor(remaining * n.rate / idleRate));
          const count = this.scheduler.chunk(n, budget);
          t = { payload: workload(j.workloadId).makeTask(start, count, j.params),
            id: `t-${j.tasks.size}`, count, attempt: 0, status: 'pending' };
          if (range) { range.start += count; if (orphan && range.start === range.end) j.orphans.shift(); }
          else j.next += count;
          j.tasks.set(t.id, t);
        }
      }
      idleRate -= n.rate;
      if (!t) continue;
      t.attempt++; t.owner = id; t.status = 'leased'; t.sent = this.now(); t.deadline = t.sent + this.scheduler.leaseMs(n, t.count);
      n.busy = t.id; n.assigned++; assigned++;
      const message = { jobId: j.id, workloadId: j.workloadId, task: { ...t.payload, id: t.id, attempt: t.attempt } };
      if (this.send(id, 'task', message) === false) { this.requeue(n, 'send-failed'); n.cooldown = this.now() + 1000; }
      else this.event('task-assigned', { jobId: j.id, taskId: t.id, nodeId: id, count: t.count, attempt: t.attempt });
    }
    return assigned;
  }
  requeue(n, reason) {
    const j = this.job, t = j?.tasks.get(n.busy); n.busy = null;
    if (!t || t.status !== 'leased' || j.status !== 'running') return;
    this.send(n.id, 'cancel', { jobId: j.id, taskId: t.id, attempt: t.attempt });
    t.status = 'pending'; t.owner = null; j.reassigned++; n.reassigned++;
    this.event('task-reassigned', { taskId: t.id, reason, attempt: t.attempt });
    if (t.attempt >= this.maxAttempts) { this.abort(`Retry limit: ${t.id}`); return; }
    j.pending.push(t);
  }
  accept(id, message) {
    const j = this.job, n = this.nodes.get(id);
    if (!j || !message || message.jobId !== j.id) return false;
    const t = j.tasks.get(message.taskId);
    if (t?.status === 'done') { j.duplicates++; return false; }
    if (j.status !== 'running' || !n?.connected || !t || t.status !== 'leased' || t.owner !== id || t.attempt !== message.attempt) { j.rejected++; return false; }
    if (!workload(j.workloadId).validResult(t, message.result) || !Number.isFinite(message.computeMs) || message.computeMs < 0) {
      j.rejected++; this.requeue(n, 'invalid-result'); n.cooldown = this.now() + 1000; this.dispatch(); return false;
    }
    const elapsed = this.now() - t.sent;
    this.scheduler.observe(n, t.count, elapsed);
    n.busy = null; n.completed++; n.units += t.count; n.computeMs += message.computeMs;
    t.status = 'done'; t.result = message.result; j.completed++; j.units += t.count;
    this.event('task-completed', { taskId: t.id, nodeId: id, elapsedMs: elapsed, rate: n.rate });
    if (j.units === j.totalUnits && j.pending.length === 0 && [...j.tasks.values()].every(t => t.status === 'done')) {
      j.result = workload(j.workloadId).merge([...j.tasks.values()].map(t => t.result)); j.status = 'completed'; j.ended = this.now();
      this.event('job-completed', { jobId: j.id, totalMs: j.ended - j.started, result: j.result });
    } else this.dispatch();
    return true;
  }
  tick() {
    const now = this.now();
    for (const n of this.nodes.values()) {
      if (!n.connected) continue;
      if (now - n.lastSeen > this.heartbeatMs) { this.removeNode(n.id, 'heartbeat-timeout'); continue; }
      const t = this.job?.tasks.get(n.busy);
      if (t?.status === 'leased' && now > t.deadline) {
        n.slow = true; this.scheduler.penalize(n); n.cooldown = now + 1000; this.requeue(n, 'lease-timeout');
      }
    }
    this.dispatch();
  }
  abort(reason = 'Cancelled') {
    const j = this.job; if (!j || j.status !== 'running') return;
    j.status = 'failed'; j.error = reason; j.ended = this.now();
    for (const n of this.nodes.values()) {
      if (n.busy) this.send(n.id, 'cancel', { jobId: j.id, taskId: n.busy });
      n.busy = null;
    }
    this.event('job-failed', { reason });
  }
  snapshot() {
    const j = this.job, elapsedMs = j ? Math.max(1, (j.ended ?? this.now()) - j.started) : 0;
    const totalRate = [...this.nodes.values()].filter(n => n.connected && (!j || j.nodeIds.includes(n.id))).reduce((a, n) => a + n.rate, 0);
    return {
      nodes: [...this.nodes.values()].map(n => ({ ...n, rtts: undefined, latency: percentiles(n.rtts),
        state: !n.connected ? 'offline' : n.cooldown > this.now() ? 'recovering' : n.slow ? 'slow' : n.busy ? 'working' : 'ready',
        capacityShare: n.connected && (!j || j.nodeIds.includes(n.id)) ? n.rate / totalRate * 100 : 0,
        loadPercent: n.busy ? 100 : 0, utilizationPercent: elapsedMs ? Math.min(100, 100 * n.computeMs / elapsedMs) : 0 })),
      job: j ? { id: j.id, workloadId: j.workloadId, params: j.params, mode: j.mode, nodeIds: j.nodeIds, status: j.status,
        completed: j.completed, created: j.tasks.size, units: j.units, percent: j.units / j.totalUnits * 100,
        reassigned: j.reassigned, duplicates: j.duplicates, rejected: j.rejected, elapsedMs,
        throughput: j.units / elapsedMs * 1000, result: j.result, error: j.error } : null
    };
  }
}
