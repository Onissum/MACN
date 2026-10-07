import { workload, benchmark } from '/workloads.js';
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'benchmark') { self.postMessage({ type: 'benchmark', benchmark: benchmark() }); return; }
    const { jobId, workloadId, task } = data;
    const start = performance.now(); const result = workload(workloadId).compute(task);
    self.postMessage({ type: 'result', jobId, taskId: task.id, attempt: task.attempt, result, computeMs: performance.now() - start });
  } catch (e) { self.postMessage({ type: 'error', error: e.message }); }
};
