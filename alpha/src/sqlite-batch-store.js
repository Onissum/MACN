import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// Single-coordinator durable ledger. The interface is deliberately small so a
// PostgreSQL implementation can replace this prototype when write concurrency
// or multi-coordinator operation becomes a measured requirement.
export class SqliteBatchStore {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS batch_jobs (
        id TEXT PRIMARY KEY,
        workload_id TEXT NOT NULL,
        params_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
        total_units INTEGER NOT NULL CHECK(total_units > 0),
        next_unit INTEGER NOT NULL DEFAULT 0,
        chunk_size INTEGER NOT NULL CHECK(chunk_size > 0),
        completed_units INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        result_json TEXT,
        error TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS batch_tasks (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        count INTEGER NOT NULL CHECK(count > 0),
        status TEXT NOT NULL CHECK(status IN ('pending','leased','completed','failed')),
        node_id TEXT,
        lease_token TEXT,
        lease_until INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0,
        result_json TEXT,
        compute_ms REAL,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        UNIQUE(job_id, ordinal)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS batch_tasks_claim_idx ON batch_tasks(job_id, status, ordinal);
      CREATE INDEX IF NOT EXISTS batch_tasks_expiry_idx ON batch_tasks(job_id, status, lease_until);
    `);
    this.statements = {
      createJob: this.db.prepare(`INSERT INTO batch_jobs
        (id, workload_id, params_json, status, total_units, chunk_size, created_at)
        VALUES (?, ?, ?, 'running', ?, ?, ?)`),
      job: this.db.prepare('SELECT * FROM batch_jobs WHERE id = ?'),
      claimOverview: this.db.prepare(`SELECT j.*,
        (SELECT COUNT(*) FROM batch_tasks t WHERE t.job_id=j.id AND t.status='pending') AS pending_count,
        (SELECT COUNT(*) FROM batch_tasks t WHERE t.job_id=j.id AND t.status='leased' AND t.lease_until <= ?) AS expired_count
        FROM batch_jobs j WHERE j.id=?`),
      expired: this.db.prepare(`SELECT id, attempts FROM batch_tasks
        WHERE job_id = ? AND status='leased' AND lease_until <= ? ORDER BY ordinal`),
      failTask: this.db.prepare(`UPDATE batch_tasks SET status='failed', node_id=NULL, lease_token=NULL, lease_until=NULL
        WHERE id=? AND status='leased'`),
      retryExpired: this.db.prepare(`UPDATE batch_tasks SET status='pending', node_id=NULL, lease_token=NULL, lease_until=NULL
        WHERE id=? AND status='leased'`),
      pending: this.db.prepare(`SELECT * FROM batch_tasks WHERE job_id=? AND status='pending' ORDER BY ordinal LIMIT 1`),
      insertTask: this.db.prepare(`INSERT INTO batch_tasks
        (id, job_id, ordinal, payload_json, count, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)`),
      updateCursor: this.db.prepare('UPDATE batch_jobs SET next_unit=?, status=\'running\' WHERE id=?'),
      leaseTask: this.db.prepare(`UPDATE batch_tasks SET status='leased', node_id=?, lease_token=?, lease_until=?, attempts=attempts+1
        WHERE id=? AND status='pending'`),
      renewLease: this.db.prepare(`UPDATE batch_tasks SET lease_until=MAX(lease_until, ?)
        WHERE id=? AND job_id=? AND status='leased' AND node_id=? AND lease_token=? AND lease_until > ?`),
      task: this.db.prepare('SELECT * FROM batch_tasks WHERE id=? AND job_id=?'),
      completeTask: this.db.prepare(`UPDATE batch_tasks SET status='completed', result_json=?, compute_ms=?, completed_at=?
        WHERE id=? AND status='leased' AND node_id=? AND lease_token=?`),
      completeJob: this.db.prepare(`UPDATE batch_jobs SET completed_units=?, status=?, completed_at=?, result_json=?, error=? WHERE id=?`),
      allResults: this.db.prepare(`SELECT result_json FROM batch_tasks WHERE job_id=? AND status='completed' ORDER BY ordinal`),
      counters: this.db.prepare(`SELECT
        COUNT(*) AS created,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='leased' THEN 1 ELSE 0 END) AS leased,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN attempts > 1 THEN attempts - 1 ELSE 0 END) AS reassignments
        FROM batch_tasks WHERE job_id=?`)
    };
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  createJob(job) {
    this.statements.createJob.run(job.id, job.workloadId, JSON.stringify(job.params), job.totalUnits, job.chunkSize, job.createdAt);
    return this.getJob(job.id);
  }

  claimOverview(jobId, now) { return this.statements.claimOverview.get(now, jobId); }

  claimTasks({ jobId, initial, nodeId, limit, leaseMs, maxAttempts, now, makeTask }) {
    // Most idle polls need only a read. Avoid a write transaction when the job
    // has no pending, expired, or never-issued work.
    if (!initial || initial.status !== 'running') return [];
    if (!initial.pending_count && !initial.expired_count && initial.next_unit >= initial.total_units) return [];

    return this.transaction(() => {
      const current = this.statements.job.get(jobId);
      if (!current || current.status !== 'running') return [];
      let retryLimitHit = false;
      for (const task of this.statements.expired.all(jobId, now)) {
        if (task.attempts >= maxAttempts) { this.statements.failTask.run(task.id); retryLimitHit = true; }
        else this.statements.retryExpired.run(task.id);
      }
      if (retryLimitHit) {
        this.statements.completeJob.run(current.completed_units, 'failed', now, null, 'Retry limit exceeded', jobId);
        return [];
      }

      const claimed = [];
      let job = current;
      while (claimed.length < limit) {
        let task = this.statements.pending.get(jobId);
        if (!task && job.next_unit < job.total_units) {
          const count = Math.min(job.chunk_size, job.total_units - job.next_unit);
          const payload = makeTask(job.next_unit, count, JSON.parse(job.params_json));
          const ordinal = Math.floor(job.next_unit / job.chunk_size);
          const id = `${jobId}:task:${ordinal}`;
          this.statements.insertTask.run(id, jobId, ordinal, JSON.stringify(payload), count, now);
          this.statements.updateCursor.run(job.next_unit + count, jobId);
          job = { ...job, next_unit: job.next_unit + count };
          task = this.statements.pending.get(jobId);
        }
        if (!task) break;
        const leaseToken = randomUUID();
        const leaseUntil = now + leaseMs;
        const changed = this.statements.leaseTask.run(nodeId, leaseToken, leaseUntil, task.id).changes;
        if (changed !== 1) throw Error('Task claim lost inside transaction');
        claimed.push({ id: task.id, attempt: task.attempts + 1, leaseToken, leaseUntil, leaseMs,
          payload: JSON.parse(task.payload_json), count: task.count });
      }
      return claimed;
    });
  }

  acceptResult({ jobId, taskId, nodeId, leaseToken, result, computeMs, now, validateResult, mergeResults }) {
    return this.transaction(() => {
      const job = this.statements.job.get(jobId), task = this.statements.task.get(taskId, jobId);
      if (!job || !task) return { accepted: false, reason: 'unknown-task' };
      if (task.status === 'completed') return { accepted: false, duplicate: true, reason: 'duplicate' };
      if (job.status !== 'running') return { accepted: false, reason: 'job-not-running' };
      if (task.status !== 'leased' || task.node_id !== nodeId || task.lease_token !== leaseToken) return { accepted: false, reason: 'stale-lease' };
      if (task.lease_until <= now) {
        this.statements.retryExpired.run(task.id);
        return { accepted: false, reason: 'lease-expired' };
      }
      const payload = JSON.parse(task.payload_json);
      if (!Number.isFinite(computeMs) || computeMs < 0 || !validateResult({ payload, count: task.count }, result)) {
        return { accepted: false, reason: 'invalid-result' };
      }
      const changed = this.statements.completeTask.run(JSON.stringify(result), computeMs, now, task.id, nodeId, leaseToken).changes;
      if (changed !== 1) return { accepted: false, reason: 'stale-lease' };
      const completedUnits = job.completed_units + task.count;
      const done = completedUnits === job.total_units;
      if (completedUnits > job.total_units) throw Error('Completed units exceed job total');
      const merged = done ? mergeResults(this.statements.allResults.all(jobId).map(row => JSON.parse(row.result_json))) : null;
      this.statements.completeJob.run(completedUnits, done ? 'completed' : 'running', done ? now : null,
        done ? JSON.stringify(merged) : null, null, jobId);
      return { accepted: true, duplicate: false, jobStatus: done ? 'completed' : 'running' };
    });
  }

  renewTasks({ jobId, nodeId, leases, now, leaseMs }) {
    return this.transaction(() => {
      const renewed = [], lost = [];
      for (const lease of leases) {
        const deadline = now + leaseMs;
        const changed = this.statements.renewLease.run(deadline, lease.taskId, jobId, nodeId, lease.leaseToken, now).changes;
        (changed === 1 ? renewed : lost).push(lease.taskId);
      }
      return { renewed, lost };
    });
  }

  getJob(id) {
    const row = this.statements.job.get(id);
    if (!row) return null;
    const counters = this.statements.counters.get(id);
    return { id: row.id, workloadId: row.workload_id, params: JSON.parse(row.params_json), status: row.status,
      totalUnits: row.total_units, allocatedUnits: row.next_unit, completedUnits: row.completed_units,
      remainingUnits: row.total_units - row.completed_units, chunkSize: row.chunk_size,
      tasks: { created: counters.created || 0, pending: counters.pending || 0, leased: counters.leased || 0,
        completed: counters.completed || 0, failed: counters.failed || 0, reassignments: counters.reassignments || 0 },
      createdAt: row.created_at, completedAt: row.completed_at,
      result: row.result_json ? JSON.parse(row.result_json) : null, error: row.error };
  }

  close() { if (this.db.isOpen) this.db.close(); }
}
