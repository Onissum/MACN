import { parseArgs } from 'node:util';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import os from 'node:os';
import { simulate, scenarios as simulatedScenarios } from './simulate.js';
import { realRun } from './real.js';
import { multiRun } from './multi.js';
import { capacityRun } from './capacity.js';
import { policyNames } from '../src/policies.js';
import { markdown, summarize } from './report.js';

async function main() {
  const { values } = parseArgs({ options: {
    mode: { type: 'string', default: 'simulated' }, nodes: { type: 'string' }, scenarios: { type: 'string' },
    repeats: { type: 'string', default: '3' }, samples: { type: 'string' }, seed: { type: 'string', default: '42' }, out: { type: 'string' },
    help: { type: 'boolean', default: false }
  } });
  if (values.help) { console.log('npm run lab -- --mode simulated|real|multi|capacity --nodes 10,100,1000,10000 --scenarios steady,slowdown,churn,latency --repeats 3 --seed 42 --samples 100000000 --out results/lab.json'); return; }
  const mode = values.mode, repeats = Number(values.repeats), seed = Number(values.seed);
  if (!['simulated', 'real', 'multi', 'capacity'].includes(mode)) throw Error('Invalid mode');
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10 || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff - repeats) throw Error('Invalid repeats/seed');
  const sizes = (values.nodes || (mode === 'real' ? '10,50' : mode === 'multi' ? '20' : mode === 'capacity' ? '10,100,1000' : '100,1000')).split(',').map(Number);
  const maxNodes = mode === 'real' ? 50 : mode === 'capacity' ? 1000 : mode === 'simulated' ? 10000 : 1000;
  if (sizes.some(n => !Number.isInteger(n) || n < 1 || n > maxNodes)) throw Error(`Invalid node counts (maximum ${maxNodes} for ${mode})`);
  const scenarios = (values.scenarios || (mode === 'real' ? 'steady,slowdown,churn' : 'steady,slowdown,churn,latency')).split(',');
  if (scenarios.some(s => !simulatedScenarios.includes(s) || (mode === 'real' && s === 'latency'))) throw Error('Invalid scenarios');
  const out = resolve(values.out || `results/alpha2-${mode}.json`);
  await mkdir(dirname(out), { recursive: true });
  const report = { version: '1.0.0-alpha.2', mode, complete: false, startedAt: new Date().toISOString(), config: values,
    environment: { node: process.version, os: os.platform(), cpuModel: os.cpus()[0]?.model, visibleLogicalCpus: os.cpus().length, physicalHosts: 1 }, runs: [] };
  const save = async () => {
    await writeFile(out + '.tmp', JSON.stringify(report, null, 2)); await rename(out + '.tmp', out);
    if (mode !== 'multi') await writeFile(out.replace(/\.json$/, '') + '.md', markdown(report));
  };
  for (const nodes of sizes) {
    if (mode === 'capacity') {
      for (let repeat = 0; repeat < repeats; repeat++) {
        const run = await capacityRun({ nodes, samples: Number(values.samples || nodes * 1500000), seed: seed + repeat });
        report.runs.push({ repeat: repeat + 1, ...run }); await save();
        console.log(`capacity n=${nodes} #${repeat + 1} connected=${run.connected}/${nodes}: ${run.elapsedMs.toFixed(1)} ms; verified=${run.verified}; p95 task=${run.taskRoundTripMs.p95?.toFixed(2) ?? 'n/a'} ms`);
        if (!run.verified) throw Error('Capacity probe verification failed; partial report saved at ' + out);
      }
      continue;
    }
    if (mode === 'multi') { const r = multiRun({ nodes, samples: Number(values.samples || 2000000), seed }); report.runs.push(r); await save(); if (!r.verified) throw Error('Multi-job verification failed'); continue; }
    for (const scenario of scenarios) for (let repeat = 0; repeat < repeats; repeat++) {
      let calibrationRates;
      // Counterbalance JIT/cache/thermal ordering. Each repeat is a paired seed.
      const order = [...policyNames.slice(repeat % 3), ...policyNames.slice(0, repeat % 3)];
      for (const policy of order) {
        const config = { nodes, scenario, policy, seed: seed + repeat, samples: Number(values.samples || nodes * (mode === 'real' ? 5000000 : 1000000)), calibrationRates };
        const run = mode === 'real' ? await realRun(config) : simulate(config);
        if (mode === 'real' && !calibrationRates) calibrationRates = run.calibration.map(c => c.measuredRate);
        report.runs.push({ repeat: repeat + 1, ...run }); await save();
        console.log(`${mode} n=${nodes} ${scenario} #${repeat + 1} ${policy}: ${(run.elapsedMs ?? run.modelledMs).toFixed(1)} ms; verified=${run.verified}; retries=${run.retries}`);
        if (!run.verified) throw Error('Verification failed; partial report saved at ' + out);
      }
    }
  }
  report.complete = true; report.completedAt = new Date().toISOString(); report.summary = ['multi', 'capacity'].includes(mode) ? undefined : summarize(report.runs); await save();
  console.log(`Saved ${out}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
