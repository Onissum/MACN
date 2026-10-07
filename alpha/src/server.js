import express from 'express';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Coordinator } from './coordinator.js';
import { attachNetwork } from './network.js';
const root = fileURLToPath(new URL('..', import.meta.url));
export async function startServer({ port = 3003, host = '0.0.0.0', token = process.env.MACN_TOKEN || randomBytes(12).toString('hex'), quiet = false, saveReports = true } = {}) {
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
  app.get('/workloads.js', (_, res) => res.sendFile(resolve(root, 'src/workloads.js')));
  app.use(express.static(resolve(root, 'public')));
  const server = createServer(app); let network;
  const coordinator = new Coordinator({ send: (...args) => network.send(...args),
    log: entry => { if (!quiet && !entry.type.startsWith('task-')) console.log(JSON.stringify(entry)); },
    save: async report => {
      if (!saveReports) return;
      const dir = resolve(root, 'results'); await mkdir(dir, { recursive: true });
      await writeFile(resolve(dir, `benchmark-${Date.now()}.json`), JSON.stringify(report, null, 2));
    }
  });
  network = attachNetwork(server, coordinator, token);
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, host, ok); });
  const actualPort = server.address().port;
  if (!quiet) console.log(`MACN 1.0-alpha http://localhost:${actualPort}\nSession token: ${token}\nOpen http://<PC-LAN-IP>:${actualPort} on each device. Trusted LAN demo.`);
  return { coordinator, server, token, port: actualPort, close: () => network.close() };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = await startServer({ port: Number(process.env.PORT || 3003) });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
