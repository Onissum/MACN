const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const context = { window: {}, TextEncoder, TextDecoder, Uint8Array, console };
vm.createContext(context);
vm.runInContext(fs.readFileSync('computertc-transport.js', 'utf8'), context);
const { Lane, encodeFrame, decodeFrame } = context.window.ComputeRTC;

const message = { type: 'help-offer', from: 'peer-a' };
const encoded = encodeFrame(Lane.CONTROL_CRITICAL, message);
const decoded = decodeFrame(encoded);
assert.strictEqual(decoded.lane, Lane.CONTROL_CRITICAL);
assert.deepStrictEqual(JSON.parse(decoded.payload), message);

const task = { type: 'initial-tasks', tasks: [{ id: 1 }, { id: 2 }] };
const taskDecoded = decodeFrame(encodeFrame(Lane.TASK_DATA, task));
assert.strictEqual(taskDecoded.lane, Lane.TASK_DATA);
assert.deepStrictEqual(JSON.parse(taskDecoded.payload), task);

const resultMessage = { type: 'task-result', taskId: 'm_7', result: { data: [1, 2, 3] }, duration: 12.5 };
const resultDecoded = decodeFrame(encodeFrame(Lane.TASK_DATA, resultMessage));
assert.strictEqual(resultDecoded.lane, Lane.TASK_DATA);
assert.deepStrictEqual(JSON.parse(resultDecoded.payload), resultMessage);

const completion = { type: 'job-complete', completedTasks: 40, totalTasks: 40 };
const completionDecoded = decodeFrame(encodeFrame(Lane.CONTROL_CRITICAL, completion));
assert.strictEqual(completionDecoded.lane, Lane.CONTROL_CRITICAL);
assert.deepStrictEqual(JSON.parse(completionDecoded.payload), completion);

assert.throws(() => decodeFrame(new Uint8Array([1, 2, 3, 4])), /non riconosciuto/);
console.log('ComputeRTC v0.5: tutti i test del protocollo sono superati.');
