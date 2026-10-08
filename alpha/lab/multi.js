import { performance } from 'node:perf_hooks';
import { JobBroker } from '../src/broker.js';
import { Events } from './events.js';
import { rangeWorkload } from './range-workload.js';
import { coverage } from './simulate.js';

export function multiRun({ nodes = 20, samples = 2000000, seed = 42, loseNode = true } = {}) {
  if (!Number.isInteger(nodes) || nodes < 2 || nodes > 1000) throw Error('multi nodes: 2..1000');
  rangeWorkload.validate({ samples, seed });
  const wall = performance.now(), events = new Events(), slots = new Map(), owners = ['alice', 'bob', 'carol'];
  const overlapTurns = Object.fromEntries(owners.map(owner => [owner, 0]));
  let now = 0, assignments = 0, peakSlots = 0, collecting = false;
  const broker = new JobBroker({ now: () => now, send(id, type, message) {
    if (type === 'cancel') { if (slots.get(id)?.requestId === message.requestId) slots.delete(id); return true; }
    if (slots.has(id)) throw Error('Overlapping global node leases');
    slots.set(id, message); assignments++; peakSlots = Math.max(peakSlots, slots.size);
    if (collecting && owners.every(owner => [...broker.jobs.values()].some(e => e.owner === owner && e.engine.job.status === 'running'))) overlapTurns[broker.jobs.get(message.requestId).owner]++;
    const rate = [600, 200, 60][Number(id.slice(1)) % 3];
    events.push(now + message.task.count / rate + 8, () => {
      if (slots.get(id) !== message) return;
      slots.delete(id);
      const result = { requestId: message.requestId, jobId: message.jobId, taskId: message.task.id, attempt: message.task.attempt,
        result: rangeWorkload.compute(message.task), computeMs: message.task.count / rate };
      broker.accept(id, result);
      // Every result is duplicated after acceptance: must not free a newer slot.
      broker.accept(id, result);
    });
    return true;
  } });
  for (let i = 0; i < nodes; i++) broker.addNode(`n${i}`, `node-${i}`, { workload: rangeWorkload.id, rate: [600, 200, 60][i % 3] });
  // Alice submits more jobs; fairness is per owner, not per number of requests.
  for (const owner of ['alice', 'alice', 'alice', 'bob', 'carol']) broker.submit({ owner, workloadId: rangeWorkload.id, params: { samples, seed } });
  collecting = true;
  if (loseNode) events.push(200, () => { slots.delete('n0'); broker.removeNode('n0'); });
  function pulse() {
    for (const n of broker.nodes.values()) if (n.connected) broker.heartbeat(n.id, 8);
    broker.tick(); if ([...broker.jobs.values()].some(e => e.engine.job.status === 'running')) events.push(now + 500, pulse);
  }
  events.push(0, pulse);
  while ([...broker.jobs.values()].some(e => e.engine.job.status === 'running') && events.size) {
    const event = events.pop(); now = event.at; event.fn();
    if (now > 120000) throw Error('Multi-job simulation deadline');
  }
  const jobs = broker.snapshot(), expected = rangeWorkload.compute({ start: 0, count: samples, seed });
  const verified = jobs.every(j => j.status === 'completed' && JSON.stringify(j.result) === JSON.stringify(expected) && coverage(broker.jobs.get(j.requestId).engine.job.tasks, samples));
  return { kind: 'multi-owner-discrete-event-simulation', nodes, samplesPerJob: samples, seed,
    verified, peakSimultaneousNodeSlots: peakSlots, assignments, modelledMs: now, wallMs: performance.now() - wall,
    slotTurnsWhileAllOwnersHadWork: overlapTurns, jobs,
    note: 'Five concurrent requests by three logical owners, sharing one slot per node. Exact synthetic checksum, no physical cluster. Equal turns per owner are not equal CPU time; owner labels are not authenticated identities.' };
}
