import test from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { startServer } from '../src/server.js';
import { monteCarlo } from '../src/workloads.js';
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 15000) { const start = Date.now(); while (!fn()) { if (Date.now() - start > timeout) throw Error('Timed out'); await wait(20); } }
async function client(app, name, { stall = false, duplicate = false } = {}) {
  const socket = io(`http://127.0.0.1:${app.port}`, { transports: ['websocket'], auth: { token: app.token }, reconnection: false });
  socket.on('ping-app', n => socket.emit('pong-app', n));
  socket.on('task', m => {
    if (stall) return;
    const result = { jobId: m.jobId, taskId: m.task.id, attempt: m.task.attempt, result: monteCarlo.compute(m.task), computeMs: 1 };
    socket.emit('result', result); if (duplicate) socket.emit('result', result);
  });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  await new Promise((resolve, reject) => socket.emit('register', { name, benchmark: { workload: monteCarlo.id, rate: 100 } }, ack => ack.ok ? resolve() : reject(Error(ack.error))));
  return socket;
}
test('real WebSocket suite, duplicate fencing, repeatability and token rejection', async () => {
  const app = await startServer({ port: 0, quiet: true, saveReports: false }); const sockets = [];
  try {
    for (const n of ['a', 'b', 'c']) sockets.push(await client(app, n, { duplicate: true }));
    const bad = io(`http://127.0.0.1:${app.port}`, { transports: ['websocket'], auth: { token: 'wrong' }, reconnection: false });
    sockets.push(bad); await new Promise(resolve => bad.once('connect_error', e => { assert.match(e.message, /token/); resolve(); }));
    const response = await new Promise(resolve => sockets[0].emit('start-suite', { params: { samples: 1000000, seed: 42 }, repeats: 2 }, resolve));
    assert.equal(response.ok, true); await until(() => app.coordinator.suite.status !== 'running');
    const report = app.coordinator.reports.at(-1); assert.equal(report.status, 'completed');
    assert.equal(report.pairs.length, 2); assert.ok(report.pairs.every(p => p.verified && p.contributors.length === 3));
    assert.ok(report.runs.some(r => r.job.duplicates > 0));
    const root = await fetch(`http://127.0.0.1:${app.port}/`); assert.equal(root.status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/src/server.js`)).status, 404);
  } finally { sockets.forEach(s => s.disconnect()); await app.close(); }
});
test('real connection lost with in-flight task is recovered by surviving nodes', async () => {
  const app = await startServer({ port: 0, quiet: true, saveReports: false }); const sockets = [];
  try {
    sockets.push(await client(app, 'lost', { stall: true }), await client(app, 'survivor'));
    app.coordinator.engine.start({ params: { samples: 1000000, seed: 42 } });
    const lost = app.coordinator.engine.nodes.get(sockets[0].id); assert.ok(lost.busy);
    sockets[0].disconnect(); await until(() => app.coordinator.engine.job.status === 'completed');
    assert.equal(app.coordinator.engine.job.reassigned, 1);
    assert.equal(app.coordinator.engine.job.result.hits, monteCarlo.compute({ start: 0, count: 1000000, seed: 42 }).hits);
  } finally { sockets.forEach(s => s.disconnect()); await app.close(); }
});
test('real responsive but stalled node loses lease and job completes', async () => {
  const app = await startServer({ port: 0, quiet: true, saveReports: false }); const sockets = [];
  try {
    sockets.push(await client(app, 'stalled', { stall: true }), await client(app, 'survivor'));
    app.coordinator.engine.start({ params: { samples: 1000000, seed: 42 } });
    await until(() => app.coordinator.engine.job.status === 'completed');
    assert.ok(app.coordinator.engine.job.reassigned > 0);
    assert.ok(app.coordinator.engine.nodes.get(sockets[0].id).connected);
    assert.ok(app.coordinator.engine.nodes.get(sockets[0].id).slow);
  } finally { sockets.forEach(s => s.disconnect()); await app.close(); }
});
