import { TaskEngine } from './engine.js';
import { createPolicy } from './policies.js';
import { workload } from './workloads.js';

// Experimental shared-node broker: one real slot per node across all jobs.
// Equal service opportunity per owner (round-robin), then per job within owner.
// Fairness is slot turns, not CPU seconds or globally verified user identity.
export class JobBroker {
  constructor({ send = () => true, now = () => performance.now(), maxJobs = 32, maxPerOwner = 8, maxRuntimeMs = 300000 } = {}) {
    Object.assign(this, { send, now, maxJobs, maxPerOwner, maxRuntimeMs });
    this.nodes = new Map(); this.jobs = new Map(); this.owners = new Map(); this.sequence = 0; this.ownerCursor = 0;
  }
  addNode(id, name, benchmark) {
    if (this.nodes.has(id)) throw Error('Node already registered');
    workload(benchmark?.workload);
    if (!Number.isFinite(benchmark.rate) || benchmark.rate <= 0) throw Error('Invalid benchmark');
    this.nodes.set(id, { id, name, benchmark, active: null, connected: true, lastSeen: this.now() });
    for (const entry of this.jobs.values()) {
      entry.engine.addNode(id, name, benchmark);
      if (entry.engine.job.status === 'running' && entry.workloadId === benchmark.workload) {
        entry.engine.job.nodeIds.push(id); entry.engine.job.nodeSet.add(id); entry.engine.idleNodes.add(id);
      }
    }
    this.pump();
  }
  submit({ owner, params, workloadId = 'monte-carlo-v1' }) {
    if (typeof owner !== 'string' || !owner.trim() || owner.length > 80) throw Error('Owner required (1..80 characters)');
    workload(workloadId).validate(params);
    const active = [...this.jobs.values()].filter(e => e.engine.job.status === 'running');
    if (active.length >= this.maxJobs || active.filter(e => e.owner === owner).length >= this.maxPerOwner) throw Error('Admission limit');
    if (![...this.nodes.values()].some(n => n.connected && n.benchmark.workload === workloadId)) throw Error('No compatible node');
    // Bound completed history while retaining every active request.
    for (const [oldId, entry] of this.jobs) {
      if (this.jobs.size < this.maxJobs * 2) break;
      if (entry.engine.job.status !== 'running') this.jobs.delete(oldId);
    }
    for (const oldOwner of this.owners.keys()) {
      if (![...this.jobs.values()].some(e => e.owner === oldOwner)) this.owners.delete(oldOwner);
    }
    const id = `request-${++this.sequence}`;
    const engine = new TaskEngine({ now: this.now, autoDispatch: false, jobPrefix: id,
      scheduler: createPolicy('adaptive'), send: (nodeId, type, data) => {
        const node = this.nodes.get(nodeId);
        if (type === 'task') {
          if (!node?.connected || node.active) return false;
          node.active = { id, taskId: data.task.id, attempt: data.task.attempt };
          if (this.send(nodeId, type, { ...data, requestId: id }) === false) { node.active = null; return false; }
        } else {
          if (node?.active?.id === id && node.active.taskId === data.taskId) node.active = null;
          this.send(nodeId, type, { ...data, requestId: id });
        }
        return true;
      }
    });
    for (const n of this.nodes.values()) if (n.connected) engine.addNode(n.id, n.name, n.benchmark);
    engine.start({ workloadId, params, nodeIds: [...this.nodes.values()].filter(n => n.connected && n.benchmark.workload === workloadId).map(n => n.id) });
    this.jobs.set(id, { id, owner, workloadId, engine, submitted: this.now() });
    if (!this.owners.has(owner)) this.owners.set(owner, { cursor: 0 });
    this.pump(); return id;
  }
  accept(nodeId, message) {
    const entry = this.jobs.get(message?.requestId), node = this.nodes.get(nodeId);
    if (!entry) return false;
    const active = node?.active;
    const matches = active?.id === message.requestId && active.taskId === message.taskId && active.attempt === message.attempt && message.jobId === entry.engine.job.id;
    // Clear the global slot only for the exact lease; an old duplicate cannot
    // clear a newer assignment owned by the same node.
    if (matches) node.active = null;
    const accepted = entry.engine.accept(nodeId, message);
    if (matches && node.connected && entry.engine.nodes.get(nodeId)?.busy) node.active = active;
    this.pump(); return accepted;
  }
  heartbeat(id, rtt) {
    const node = this.nodes.get(id); if (node) node.lastSeen = this.now();
    for (const entry of this.jobs.values()) entry.engine.heartbeat(id, rtt); }
  removeNode(id) {
    const node = this.nodes.get(id); if (!node) return;
    node.connected = false; node.active = null;
    for (const entry of this.jobs.values()) entry.engine.removeNode(id);
    this.pump();
  }
  cancel(id, owner) {
    const entry = this.jobs.get(id); if (!entry || entry.owner !== owner) throw Error('Request is not owned by caller');
    entry.engine.abort('Cancelled by owner'); this.pump();
  }
  tick() {
    for (const node of this.nodes.values()) if (node.connected && this.now() - node.lastSeen > 8000) this.removeNode(node.id);
    for (const entry of this.jobs.values()) {
      entry.engine.tick();
      if (entry.engine.job.status === 'running' && this.now() - entry.submitted > this.maxRuntimeMs) entry.engine.abort('Request deadline exceeded');
    }
    this.pump();
  }
  pump() {
    const activeOwners = [...this.owners.keys()].filter(owner => [...this.jobs.values()].some(e => e.owner === owner && e.engine.job.status === 'running'));
    if (!activeOwners.length) return;
    // A pass with no assignment terminates even when jobs have only in-flight tasks.
    let misses = 0;
    while ([...this.nodes.values()].some(n => n.connected && !n.active) && misses < activeOwners.length) {
      const owner = activeOwners[this.ownerCursor++ % activeOwners.length];
      const state = this.owners.get(owner), entries = [...this.jobs.values()].filter(e => e.owner === owner && e.engine.job.status === 'running');
      let assigned = 0;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[state.cursor++ % entries.length];
        assigned = entry.engine.dispatch({ force: true, limit: 1, eligible: id => this.nodes.get(id)?.connected && !this.nodes.get(id).active });
        if (assigned) break;
      }
      misses = assigned ? 0 : misses + 1;
    }
  }
  snapshot() {
    return [...this.jobs.values()].map(e => ({ requestId: e.id, owner: e.owner, ...e.engine.snapshot().job }));
  }
}
