import { performance } from 'node:perf_hooks';
import { monteCarlo } from '../src/workloads.js';
import { BatchVerifierPool } from '../src/batch-verifier-pool.js';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  return [key, rest.join('=')];
}));
const samples = Number(args.samples || 500_000);
const iterations = Number(args.iterations || 7);
if (!Number.isSafeInteger(samples) || samples < 1_000 || samples > 2_000_000_000) throw Error('--samples must be 1000..2000000000');
if (!Number.isInteger(iterations) || iterations < 3 || iterations > 101) throw Error('--iterations must be 3..101');

const task = { start: 0, count: samples, seed: 42 };
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
monteCarlo.compute(task); // warm-up
const workerMs = [], verificationMs = [], poolResults = [];
const verifierPool = new BatchVerifierPool({ size: 1, maxQueue: Math.max(16, iterations) });
for (let index = 0; index < iterations; index++) {
  const computeStarted = performance.now();
  const result = monteCarlo.compute(task);
  const computedAt = performance.now();
  const check = monteCarlo.verifyResult(task, result);
  const verifiedAt = performance.now();
  if (!check.valid) throw Error('Trusted verification disagrees with the workload result');
  workerMs.push(computedAt - computeStarted);
  verificationMs.push(verifiedAt - computedAt);
  poolResults.push(await verifierPool.verify({ workloadId: monteCarlo.id, task, result }));
}
await verifierPool.close();
if (poolResults.some(check => !check.valid)) throw Error('Worker-thread verifier disagrees with workload result');
const computeMedianMs = median(workerMs), verifyMedianMs = median(verificationMs);
const ratio = verifyMedianMs / computeMedianMs;
const pool = verifierPool.snapshot();
console.log(JSON.stringify({
  workload: monteCarlo.id, samples, iterations, warmupRuns: 1,
  workerComputeMedianMs: computeMedianMs,
  trustedVerificationMedianMs: verifyMedianMs,
  verificationToWorkerRatio: ratio,
  workerThreadVerification: {
    completed: pool.completed,
    computeMedianMs: pool.recent.computeP50Ms,
    endToEndMedianMs: pool.recent.endToEndP50Ms,
    endToEndP95Ms: pool.recent.endToEndP95Ms,
    endToEndP99Ms: pool.recent.endToEndP99Ms,
    queueWaitP95Ms: pool.recent.queueWaitP95Ms,
    queueWaitP99Ms: pool.recent.queueWaitP99Ms
  },
  estimatedTotalComputeFactorTrusted: 1 + ratio,
  estimatedTotalComputeFactorFullRedundancy: 2 + 2 * ratio,
  methodology: 'One local Node process, sequential medians; factors estimate compute work only and exclude HTTP, SQLite, scheduling and heterogeneous devices.'
}, null, 2));
