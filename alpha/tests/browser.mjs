import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { launchNodes, runSuite } from './browser-harness.mjs';
const h = await launchNodes();
try {
  const report = await runSuite(h);
  assert.ok(report.pairs.every(p => p.verified && p.contributors.length === 3));
  assert.deepEqual(h.errors, []);
  await h.pages[0].waitForFunction(() => !document.querySelector('#export').disabled);
  const download = h.pages[0].waitForEvent('download'); await h.pages[0].click('#export'); assert.equal((await download).suggestedFilename(), 'macn-benchmark.json');
  await mkdir('results', { recursive: true });
  await h.pages[0].screenshot({ path: 'results/dashboard-desktop.png', fullPage: true });
  await h.pages[2].screenshot({ path: 'results/dashboard-mobile.png', fullPage: true });
  const overflow = await h.pages[2].evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, 'mobile page overflow');
  // A second complete suite in the same sessions catches worker lifecycle regressions.
  const second = await runSuite(h, { samples: 10000000 }); assert.equal(second.status, 'completed');
  await h.pages[2].click('#leave'); await h.pages[0].waitForFunction(() => document.querySelector('#online').textContent === '2');
  console.log(JSON.stringify({ browserTests: 'passed', verified: true, contributors: 3, repeatSuite: 'passed', mobile: 'passed', speedup: report.medianSpeedup }));
} finally { await h.close(); }
