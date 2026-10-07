import { workloads, monteCarlo } from '../src/workloads.js';
// Control-plane fixture. O(1) exact checksum, NOT Monte Carlo computation.
const MOD = 4294967291n;
export const rangeWorkload = {
  id: 'range-check-v1', unit: 'modelled-units',
  validate: params => monteCarlo.validate(params),
  totalUnits: params => params.samples,
  makeTask: (start, count, params) => ({ start, count, seed: params.seed }),
  compute({ start, count, seed }) {
    const first = BigInt(start + seed), size = BigInt(count);
    return { count, checksum: Number((size * (2n * first + size - 1n) / 2n) % MOD) };
  },
  validResult(task, result) {
    return result?.count === task.count && Number.isInteger(result.checksum) && result.checksum >= 0 && result.checksum < Number(MOD);
  },
  merge(results) {
    return results.reduce((a, r) => ({ count: a.count + r.count, checksum: (a.checksum + r.checksum) % Number(MOD) }), { count: 0, checksum: 0 });
  }
};
workloads.set(rangeWorkload.id, rangeWorkload);
