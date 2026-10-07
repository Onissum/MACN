import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const context = { window: {}, TextEncoder, TextDecoder, Uint8Array, console };
vm.createContext(context);
vm.runInContext(readFileSync(new URL('../../macn-computertc-v0.5.2/computertc-transport.js', import.meta.url), 'utf8'), context);
const { ComputeRTCTransport, Lane, decodeFrame } = context.window.ComputeRTC;
function channel(label) {
  return { label, readyState: 'open', bufferedAmount: 0, messages: [], handlers: {},
    addEventListener(e, fn) { this.handlers[e] = fn; },
    send(data) { this.messages.push(data); }, close() { this.readyState = 'closed'; this.handlers.close(); } };
}
test('legacy ComputeRTC separates queues and drains control despite blocked data', () => {
  const t = new ComputeRTCTransport('peer'), control = channel('computertc-control'), data = channel('computertc-data');
  t.registerChannel(control); t.registerChannel(data); assert.equal(t.getState(), 'OPEN');
  data.bufferedAmount = 5 * 1024 * 1024;
  assert.equal(t.trySend(Lane.TASK_DATA, { task: 1 }), 'QUEUED');
  assert.equal(t.trySend(Lane.CONTROL_CRITICAL, { cancel: 1 }), 'SENT');
  assert.equal(control.messages.length, 1); assert.equal(data.messages.length, 0);
  data.bufferedAmount = 0; data.handlers.bufferedamountlow(); assert.equal(data.messages.length, 1);
  assert.equal(JSON.parse(decodeFrame(data.messages[0]).payload).task, 1);
  assert.equal(t.getQueuedBytes(), 0); t.close(); assert.equal(t.getState(), 'CLOSED');
});
test('legacy ComputeRTC applies bounded queue backpressure', () => {
  const t = new ComputeRTCTransport('peer'), data = channel('computertc-data'); t.registerChannel(data); data.bufferedAmount = 5 * 1024 * 1024;
  const bytes = new Uint8Array(1024 * 1024); let result;
  for (let i = 0; i < 33; i++) result = t.trySend(Lane.TASK_DATA, bytes);
  assert.equal(result, 'BACKPRESSURE'); assert.ok(t.getQueuedBytes() <= 32 * 1024 * 1024);
});
