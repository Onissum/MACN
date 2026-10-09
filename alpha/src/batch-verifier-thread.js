import { parentPort } from 'node:worker_threads';
import { workload } from './workloads.js';

parentPort.on('message', ({ id, workloadId, task, result }) => {
  try {
    const definition = workload(workloadId);
    if (typeof definition.verifyResult !== 'function') throw Error(`Workload ${workloadId} has no trusted verifier`);
    parentPort.postMessage({ id, verification: definition.verifyResult(task, result) });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});
