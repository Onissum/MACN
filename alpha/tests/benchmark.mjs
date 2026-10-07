import { writeFile, mkdir } from 'node:fs/promises';
import { launchNodes, runSuite } from './browser-harness.mjs';
const h = await launchNodes();
try {
  const report = await runSuite(h, { repeats: 3, samples: 500000000 });
  report.environment = { kind: 'three isolated Chromium contexts on ONE Linux host', node: process.version, browser: h.browser.version(), physicalDevices: 1, warning: 'Not a PC/notebook/phone hardware benchmark; processes compete for the same CPU.' };
  await mkdir('results', { recursive: true }); await writeFile('results/benchmark-example.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ file: 'results/benchmark-example.json', pairs: report.pairs, medianSpeedup: report.medianSpeedup }));
} finally { await h.close(); }
