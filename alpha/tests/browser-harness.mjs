import { chromium } from 'playwright';
import { startServer } from '../src/server.js';
export async function launchNodes() {
  const app = await startServer({ port: 0, quiet: true, saveReports: false, token: 'browser-test-token' });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const pages = [], errors = [];
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({ viewport: i === 2 ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: i === 2 });
      const page = await context.newPage(); pages.push(page);
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${app.port}`);
      await page.fill('#name', ['PC test', 'Notebook test', 'Smartphone viewport'][i]);
      await page.fill('#token', app.token); await page.click('#join');
      await page.waitForFunction(() => document.querySelector('#local').textContent.startsWith('Pronto'));
    }
    await pages[0].waitForFunction(() => document.querySelector('#online').textContent === '3');
    return { app, browser, pages, errors, async close() { await browser.close(); await app.close(); } };
  } catch (e) { await browser?.close(); await app.close(); throw e; }
}
export async function runSuite(h, { repeats = 1, samples = 20000000 } = {}) {
  const page = h.pages[0]; await page.fill('#samples', String(samples)); await page.fill('#repeats', String(repeats)); await page.click('#run');
  await page.waitForFunction(() => document.querySelector('#phase').textContent.includes('completato'), { }, { timeout: 180000 });
  return h.app.coordinator.reports.at(-1);
}
