import { TaskEngine } from './engine.js';
import { workload } from './workloads.js';

export class Coordinator {
  constructor({ send, now, log = () => {}, save = () => {}, timeoutMs = 300000 } = {}) {
    this.logs = []; this.reports = []; this.suite = null; this.save = save; this.timeoutMs = timeoutMs;
    this.engine = new TaskEngine({ send, now, log: entry => {
      this.logs.push(entry); if (this.logs.length > 300) this.logs.shift(); log(entry);
    } });
  }
  startSuite({ params, repeats = 3, baselineId, nodeIds } = {}) {
    if (this.suite?.status === 'running') throw Error('Benchmark already running');
    params = workload('monte-carlo-v1').validate(params);
    if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw Error('repeats: 1..10');
    nodeIds = nodeIds || [...this.engine.nodes.values()].filter(n => n.connected).map(n => n.id);
    if (!Array.isArray(nodeIds) || !nodeIds.length || new Set(nodeIds).size !== nodeIds.length || nodeIds.some(id => !this.engine.nodes.get(id)?.connected)) throw Error('Invalid node selection');
    baselineId = baselineId || [...nodeIds].sort((a, b) => this.engine.nodes.get(b).rate - this.engine.nodes.get(a).rate)[0];
    if (!nodeIds.includes(baselineId)) throw Error('Baseline node is not in selection');
    this.suite = { status: 'running', params, repeats, baselineId, nodeIds: [...nodeIds], round: 1, phase: 'baseline', runs: [], pairs: [], startedAt: new Date().toISOString() };
    this.nextJob();
  }
  nextJob() {
    const s = this.suite;
    try { this.engine.start({ params: s.params, nodeIds: s.phase === 'baseline' ? [s.baselineId] : s.nodeIds.filter(id => this.engine.nodes.get(id)?.connected), mode: s.phase }); }
    catch (e) { s.status = 'failed'; s.error = e.message; }
  }
  tick() {
    this.engine.tick();
    const s = this.suite, j = this.engine.job;
    if (!s || s.status !== 'running' || !j) return;
    if (j.status === 'running' && this.engine.now() - j.started > this.timeoutMs) this.engine.abort('Job deadline exceeded');
    if (j.status === 'running' && !j.nodeIds.some(id => this.engine.nodes.get(id)?.connected)) this.engine.abort('No selected nodes remain connected');
    if (j.status === 'failed') { s.status = 'failed'; s.error = j.error; return; }
    if (j.status !== 'completed') return;
    const run = this.engine.snapshot(); s.runs.push(run);
    if (s.phase === 'baseline') { s.phase = 'distributed'; this.nextJob(); return; }
    const baseline = s.runs[s.runs.length - 2], distributed = run;
    const verified = baseline.job.result.hits === distributed.job.result.hits && baseline.job.result.count === distributed.job.result.count;
    s.pairs.push({ round: s.round, verified, speedup: verified ? baseline.job.elapsedMs / distributed.job.elapsedMs : null,
      baselineMs: baseline.job.elapsedMs, distributedMs: distributed.job.elapsedMs,
      contributors: distributed.nodes.filter(n => n.completed > 0).map(n => n.id),
      cohortChanged: s.nodeIds.some(id => !this.engine.nodes.get(id)?.connected) });
    if (!verified) { s.status = 'failed'; s.error = 'Sequential/distributed result mismatch'; return; }
    if (s.round < s.repeats) { s.round++; s.phase = 'baseline'; this.nextJob(); return; }
    s.status = 'completed';
    const speeds = s.pairs.map(p => p.speedup).sort((a, b) => a - b);
    const middle = Math.floor(speeds.length / 2);
    const report = { version: '1.0.0-alpha.2', transport: 'socket.io-websocket', ...structuredClone(s),
      medianSpeedup: speeds.length % 2 ? speeds[middle] : (speeds[middle - 1] + speeds[middle]) / 2,
      methodology: 'Warm-up + median of five calibration runs. Each pair: full single-node then full distributed job; coordinator monotonic wall time including dispatch, network, retries and merge. One worker per browser; no claimed physical-device count.',
      logs: [...this.logs] };
    this.reports.push(report); if (this.reports.length > 10) this.reports.shift();
    Promise.resolve(this.save(report)).catch(e => this.engine.event('report-save-error', { message: e.message }));
  }
  cancel() { this.engine.abort('User cancelled'); if (this.suite?.status === 'running') this.suite.status = 'cancelled'; }
  snapshot() {
    return { ...this.engine.snapshot(), suite: this.suite ? { ...this.suite, runs: undefined } : null, logs: this.logs,
      latestReport: this.reports.at(-1) || null };
  }
}
