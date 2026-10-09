import express from 'express';

export function attachBatchApi(app, queue, token) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (req.get('authorization') !== `Bearer ${token}`) return res.status(401).json({ error: 'unauthorized' });
    next();
  });
  router.post('/jobs', (req, res) => {
    try { res.status(201).json(queue.createJob(req.body ?? {})); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.get('/jobs/:jobId', (req, res) => {
    const job = queue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'job-not-found' });
    res.json(job);
  });
  router.post('/jobs/:jobId/work', (req, res) => {
    try {
      const tasks = queue.claim({ jobId: req.params.jobId, nodeId: req.body?.nodeId, limit: req.body?.limit ?? 1,
        unitsPerSecond: req.body?.unitsPerSecond, targetSeconds: req.body?.targetSeconds ?? 30 });
      if (tasks === null) return res.status(404).json({ error: 'job-not-found' });
      res.json({ tasks });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.get('/verification/metrics', (_req, res) => res.json(queue.verificationMetrics()));
  router.post('/jobs/:jobId/results', async (req, res) => {
    try {
      const outcome = await queue.submit({ jobId: req.params.jobId, ...req.body });
      res.status(outcome.accepted || outcome.duplicate ? 200 : outcome.received ? 202 : 409).json(outcome);
    } catch (error) {
      const status = error.code === 'VERIFIER_BUSY' ? 503 : 500;
      if (status === 503) res.setHeader('Retry-After', '2');
      res.status(status).json({ error: status === 503 ? 'verification-busy' : 'verification-failed' });
    }
  });
  router.post('/jobs/:jobId/leases/renew', (req, res) => {
    try {
      const result = queue.renew({ jobId: req.params.jobId, nodeId: req.body?.nodeId, leases: req.body?.leases });
      if (result === null) return res.status(404).json({ error: 'job-not-found' });
      res.json(result);
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/batch', router);
}
