// Pure, deterministic workload registry shared by browser workers and Node tests.
// A sample depends only on seed and absolute index, never on partition boundaries.
function mix(x) {
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}
export const monteCarlo = {
  id: 'monte-carlo-v1', unit: 'samples',
  validate(params) {
    if (!params || !Number.isSafeInteger(params.samples) || params.samples < 1000 || params.samples > 2_000_000_000 ||
        !Number.isInteger(params.seed) || params.seed < 0 || params.seed > 0xffffffff) throw Error('samples: 1000..2000000000; seed: uint32');
    return { samples: params.samples, seed: params.seed };
  },
  totalUnits(params) { return params.samples; },
  makeTask(start, count, params) { return { start, count, seed: params.seed }; },
  compute({ start, count, seed }) {
    let hits = 0;
    for (let i = start; i < start + count; i++) {
      const x = mix((i ^ seed) >>> 0) / 4294967296;
      const y = mix((i ^ seed ^ 0x9e3779b9) >>> 0) / 4294967296;
      if (x * x + y * y <= 1) hits++;
    }
    return { hits, count };
  },
  validResult(task, result) {
    return result && result.count === task.count && Number.isInteger(result.hits) && result.hits >= 0 && result.hits <= task.count;
  },
  merge(results) {
    const { hits, count } = results.reduce((a, r) => ({ hits: a.hits + r.hits, count: a.count + r.count }), { hits: 0, count: 0 });
    return { hits, count, pi: 4 * hits / count };
  }
};
export const workloads = new Map([[monteCarlo.id, monteCarlo]]);
export function workload(id) {
  const w = workloads.get(id);
  if (!w) throw Error('Unknown workload: ' + id);
  return w;
}
export function benchmark(id = monteCarlo.id) {
  const w = workload(id), task = { start: 0, count: 250_000, seed: 42 };
  w.compute(task); // warm-up
  const times = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    w.compute(task);
    times.push(Math.max(0.01, performance.now() - start));
  }
  times.sort((a, b) => a - b);
  return { workload: id, rate: task.count / times[2], durationMs: times[2], samples: task.count };
}
