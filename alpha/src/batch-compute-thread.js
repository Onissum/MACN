import { parentPort } from 'node:worker_threads';
import { workload } from './workloads.js';

parentPort.on('message', ({ id, payload }) => {
  try { parentPort.postMessage({ id, result: workload('monte-carlo-v1').compute(payload) }); }
  catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
