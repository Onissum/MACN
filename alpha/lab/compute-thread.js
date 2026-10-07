import { parentPort } from 'node:worker_threads';
import { benchmark, monteCarlo } from '../src/workloads.js';
parentPort.postMessage({ type: 'ready', benchmark: benchmark() });
parentPort.on('message', message => {
  const started = performance.now();
  const result = monteCarlo.compute(message.task);
  parentPort.postMessage({ ...message, type: 'result', result, computeMs: performance.now() - started });
});
