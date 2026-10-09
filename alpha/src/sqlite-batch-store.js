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
      CREATE TABLE IF NOT EXISTS batch_task_results (
        id INTEGER PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES batch_tasks(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        result_json TEXT NOT NULL,
        compute_ms REAL NOT NULL DEFAULT 0,
        received_at INTEGER NOT NULL,
        verification_status TEXT NOT NULL CHECK(verification_status IN ('received','pending_redundancy','verified','rejected','legacy')),
        verification_ms REAL NOT NULL DEFAULT 0,
        verification_queue_wait_ms REAL NOT NULL DEFAULT 0,
        verification_elapsed_ms REAL NOT NULL DEFAULT 0,
        reason TEXT,
        UNIQUE(task_id, attempt)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS batch_task_candidates (
        task_id TEXT PRIMARY KEY REFERENCES batch_tasks(id) ON DELETE CASCADE,
        node_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        result_json TEXT NOT NULL,
        compute_ms REAL NOT NULL,
        received_at INTEGER NOT NULL
      ) STRICT;
    `);
    const addColumn = (table, name, declaration) => {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.some(column => column.name === name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`);
    };
    // Additive migration: existing jobs remain readable, and old completed
    // results retain their historical status instead of being silently reset.
    addColumn('batch_jobs', 'verification_json', `TEXT NOT NULL DEFAULT '{"mode":"trusted","redundancySampleRate":0}'`);
    addColumn('batch_tasks', 'verification_state', `TEXT NOT NULL DEFAULT 'legacy' CHECK(verification_state IN ('legacy','not_started','received','pending_redundancy','verified','rejected'))`);
    addColumn('batch_task_results', 'verification_queue_wait_ms', 'REAL NOT NULL DEFAULT 0');
    addColumn('batch_task_results', 'verification_elapsed_ms', 'REAL NOT NULL DEFAULT 0');
    addColumn('batch_task_results', 'compute_ms', 'REAL NOT NULL DEFAULT 0');
    this.statements = {
      createJob: this.db.prepare(`INSERT INTO batch_jobs
        (id, workload_id, params_json, status, total_units, chunk_size, created_at, verification_json)
        VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`),
      job: this.db.prepare('SELECT * FROM batch_jobs WHERE id = ?'),
      claimOverview: this.db.prepare(`SELECT j.*,
        (SELECT COUNT(*) FROM batch_tasks t WHERE t.job_id=j.id AND t.status='pending') AS pending_count,
        (SELECT COUNT(*) FROM batch_tasks t WHERE t.job_id=j.id AND t.status='leased' AND t.lease_until <= ?) AS expired_count
        FROM batch_jobs j WHERE j.id=?`),
      expired: this.db.prepare(`SELECT id, attempts FROM batch_tasks
        WHERE job_id = ? AND status='leased' AND lease_until <= ? ORDER BY ordinal`),
      retireExpiredResult: this.db.prepare(`UPDATE batch_task_results SET verification_status='rejected', reason='attempt-expired'
        WHERE task_id=? AND attempt=? AND verification_status='received'`),
      failTask: this.db.prepare(`UPDATE batch_tasks SET status='failed', node_id=NULL, lease_token=NULL, lease_until=NULL
        WHERE id=? AND status='leased'`),
      retryExpired: this.db.prepare(`UPDATE batch_tasks SET status='pending', node_id=NULL, lease_token=NULL, lease_until=NULL
        WHERE id=? AND status='leased'`),
      pending: this.db.prepare(`SELECT t.* FROM batch_tasks t WHERE t.job_id=? AND t.status='pending'
        AND NOT EXISTS (SELECT 1 FROM batch_task_candidates c WHERE c.task_id=t.id AND c.node_id=?)
        ORDER BY t.ordinal LIMIT 1`),
      insertTask: this.db.prepare(`INSERT INTO batch_tasks
        (id, job_id, ordinal, payload_json, count, status, created_at, verification_state)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, 'not_started')`),
      updateCursor: this.db.prepare('UPDATE batch_jobs SET next_unit=?, status=\'running\' WHERE id=?'),
      leaseTask: this.db.prepare(`UPDATE batch_tasks SET status='leased', node_id=?, lease_token=?, lease_until=?, attempts=attempts+1
        WHERE id=? AND status='pending'`),
      markTask: this.db.prepare('UPDATE batch_tasks SET verification_state=? WHERE id=?'),
      renewLease: this.db.prepare(`UPDATE batch_tasks SET lease_until=MAX(lease_until, ?)
        WHERE id=? AND job_id=? AND status='leased' AND node_id=? AND lease_token=? AND lease_until > ?`),
      task: this.db.prepare('SELECT * FROM batch_tasks WHERE id=? AND job_id=?'),
      completeTask: this.db.prepare(`UPDATE batch_tasks SET status='completed', result_json=?, compute_ms=?, completed_at=?
        , verification_state='verified' WHERE id=? AND status='leased' AND node_id=? AND lease_token=?`),
      releaseTask: this.db.prepare(`UPDATE batch_tasks SET status='pending', node_id=NULL, lease_token=NULL, lease_until=NULL, verification_state=?
        WHERE id=? AND status='leased' AND node_id=? AND lease_token=?`),
      failTaskNow: this.db.prepare(`UPDATE batch_tasks SET status='failed', node_id=NULL, lease_token=NULL, lease_until=NULL, verification_state='rejected'
        WHERE id=? AND status='leased' AND node_id=? AND lease_token=?`),
      candidate: this.db.prepare('SELECT * FROM batch_task_candidates WHERE task_id=?'),
      attemptResult: this.db.prepare('SELECT * FROM batch_task_results WHERE task_id=? AND attempt=?'),
      pendingVerifications: this.db.prepare(`SELECT j.id AS job_id,j.workload_id,t.id AS task_id,t.payload_json,t.count,
        t.node_id,t.lease_token,t.lease_until,t.attempts,r.attempt,r.result_json,r.compute_ms AS result_compute_ms,
        c.node_id AS candidate_node_id,c.attempt AS candidate_attempt,c.result_json AS candidate_result_json,
        c.compute_ms AS candidate_compute_ms
        FROM batch_task_results r JOIN batch_tasks t ON t.id=r.task_id JOIN batch_jobs j ON j.id=t.job_id
        LEFT JOIN batch_task_candidates c ON c.task_id=t.id
        WHERE r.verification_status='received' AND t.status='leased' AND t.node_id=r.node_id
        AND t.attempts=r.attempt AND t.lease_until > ? AND j.status='running' ORDER BY r.received_at`),
      extendLeaseForVerification: this.db.prepare(`UPDATE batch_tasks SET lease_until=MAX(lease_until, ?),verification_state='received'
        WHERE id=? AND status='leased' AND node_id=? AND lease_token=? AND attempts=? AND lease_until > ?`),
      insertResult: this.db.prepare(`INSERT INTO batch_task_results(task_id,node_id,attempt,result_json,compute_ms,received_at,verification_status,verification_ms,reason)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id,attempt) DO UPDATE SET result_json=excluded.result_json,compute_ms=excluded.compute_ms,
        received_at=excluded.received_at,verification_status=excluded.verification_status,verification_ms=excluded.verification_ms,reason=excluded.reason`),
      updateResultStatus: this.db.prepare(`UPDATE batch_task_results SET verification_status=?,verification_ms=?,
        verification_queue_wait_ms=?,verification_elapsed_ms=?,reason=? WHERE task_id=? AND attempt=?`),
      saveCandidate: this.db.prepare(`INSERT INTO batch_task_candidates(task_id,node_id,attempt,result_json,compute_ms,received_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET node_id=excluded.node_id,attempt=excluded.attempt,
        result_json=excluded.result_json,compute_ms=excluded.compute_ms,received_at=excluded.received_at`),
      deleteCandidate: this.db.prepare('DELETE FROM batch_task_candidates WHERE task_id=?'),
      resultCounts: this.db.prepare(`SELECT
        COUNT(*) AS received,
        SUM(CASE WHEN verification_status IN ('pending_redundancy','received') THEN 1 ELSE 0 END) AS pendingVerification,
        SUM(CASE WHEN verification_status='verified' THEN 1 ELSE 0 END) AS verified,
        SUM(CASE WHEN verification_status='rejected' THEN 1 ELSE 0 END) AS rejected,
        SUM(verification_ms) AS verification_ms,
        SUM(verification_queue_wait_ms) AS verification_queue_wait_ms,
        SUM(verification_elapsed_ms) AS verification_elapsed_ms
        FROM batch_task_results r JOIN batch_tasks t ON t.id=r.task_id WHERE t.job_id=?`),
      completeJob: this.db.prepare(`UPDATE batch_jobs SET completed_units=?, status=?, completed_at=?, result_json=?, error=? WHERE id=?`),
      allResults: this.db.prepare(`SELECT result_json FROM batch_tasks WHERE job_id=? AND status='completed' ORDER BY ordinal`),
      counters: this.db.prepare(`SELECT
        COUNT(*) AS created,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='leased' THEN 1 ELSE 0 END) AS leased,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN attempts > 1 THEN attempts - 1 ELSE 0 END) AS reassignments
        FROM batch_tasks WHERE job_id=?`),
      verificationTaskCounts: this.db.prepare(`SELECT
        SUM(CASE WHEN status='completed' AND verification_state='verified' THEN 1 ELSE 0 END) AS accepted,
        SUM(CASE WHEN status='completed' AND verification_state='legacy' THEN 1 ELSE 0 END) AS legacyAccepted
        FROM batch_tasks WHERE job_id=?`)
    };
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  createJob(job) {
    this.statements.createJob.run(job.id, job.workloadId, JSON.stringify(job.params), job.totalUnits, job.chunkSize, job.createdAt, JSON.stringify(job.verification));
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
        this.statements.retireExpiredResult.run(task.id, task.attempts);
        this.statements.markTask.run('not_started', task.id);
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
        let task = this.statements.pending.get(jobId, nodeId);
        if (!task && job.next_unit < job.total_units) {
          const count = Math.min(job.chunk_size, job.total_units - job.next_unit);
          const payload = makeTask(job.next_unit, count, JSON.parse(job.params_json));
          const ordinal = Math.floor(job.next_unit / job.chunk_size);
          const id = `${jobId}:task:${ordinal}`;
          this.statements.insertTask.run(id, jobId, ordinal, JSON.stringify(payload), count, now);
          this.statements.updateCursor.run(job.next_unit + count, jobId);
          job = { ...job, next_unit: job.next_unit + count };
          task = this.statements.pending.get(jobId, nodeId);
        }
        if (!task) break;
        if (task.attempts >= maxAttempts) {
          this.statements.failTask.run(task.id);
          this.statements.completeJob.run(job.completed_units, 'failed', now, null, 'Verification retry limit exceeded', jobId);
          return [];
        }
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

  receiveResult({ jobId, taskId, nodeId, leaseToken, result, computeMs, now, maxAttempts, verificationTimeoutMs, validateResult, requiresRedundancy }) {
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
      const validComputeMs = Number.isFinite(computeMs) && computeMs >= 0;
      const existing = this.statements.attemptResult.get(task.id, task.attempts);
      if (existing?.verification_status === 'received') {
        const extended = this.statements.extendLeaseForVerification.run(now + verificationTimeoutMs, task.id,
          nodeId, leaseToken, task.attempts, now).changes;
        if (extended !== 1) return { accepted: false, reason: 'lease-expired' };
        return this.verificationContext(job, task, nodeId, leaseToken, existing,
          this.statements.candidate.get(task.id));
      }
      if (!validComputeMs || !validateResult({ payload, count: task.count }, result)) {
        this.statements.insertResult.run(task.id, nodeId, task.attempts, JSON.stringify(result ?? null), validComputeMs ? computeMs : 0,
          now, 'rejected', 0, 'invalid-format');
        this.statements.markTask.run('rejected', task.id);
        if (task.attempts >= maxAttempts) {
          this.statements.failTaskNow.run(task.id, nodeId, leaseToken);
          this.statements.completeJob.run(job.completed_units, 'failed', now, null, 'Invalid result retry limit exceeded', jobId);
        } else this.statements.releaseTask.run('rejected', task.id, nodeId, leaseToken);
        return { accepted: false, reason: 'invalid-result' };
      }

      this.statements.insertResult.run(task.id, nodeId, task.attempts, JSON.stringify(result), computeMs, now, 'received', 0, null);
      const candidate = this.statements.candidate.get(task.id);
      if (!candidate && requiresRedundancy(task.ordinal, job.id, JSON.parse(job.verification_json))) {
        this.statements.saveCandidate.run(task.id, nodeId, task.attempts, JSON.stringify(result), computeMs, now);
        this.statements.updateResultStatus.run('pending_redundancy', 0, 0, 0, null, task.id, task.attempts);
        const released = this.statements.releaseTask.run('pending_redundancy', task.id, nodeId, leaseToken).changes;
        if (released !== 1) return { accepted: false, reason: 'stale-lease' };
        return { accepted: false, received: true, pendingVerification: true, reason: 'awaiting-independent-result' };
      }
      const extended = this.statements.extendLeaseForVerification.run(now + verificationTimeoutMs, task.id,
        nodeId, leaseToken, task.attempts, now).changes;
      if (extended !== 1) return { accepted: false, reason: 'stale-lease' };
      return this.verificationContext(job, task, nodeId, leaseToken, this.statements.attemptResult.get(task.id, task.attempts), candidate);
    });
  }

  verificationContext(job, task, nodeId, leaseToken, resultRow, candidate) {
    return { needsVerification: true, jobId: job.id, workloadId: job.workload_id, taskId: task.id,
      nodeId, leaseToken, attempt: resultRow.attempt, payload: JSON.parse(task.payload_json),
      result: JSON.parse(resultRow.result_json), computeMs: resultRow.compute_ms,
      candidate: candidate ? { nodeId: candidate.node_id, attempt: candidate.attempt,
        result: JSON.parse(candidate.result_json), computeMs: candidate.compute_ms } : null };
  }

  pendingVerificationRecords(now) {
    return this.statements.pendingVerifications.all(now).map(row => ({
      needsVerification: true, jobId: row.job_id, workloadId: row.workload_id, taskId: row.task_id,
      nodeId: row.node_id, leaseToken: row.lease_token, attempt: row.attempt,
      payload: JSON.parse(row.payload_json), result: JSON.parse(row.result_json), computeMs: row.result_compute_ms,
      candidate: row.candidate_result_json ? { nodeId: row.candidate_node_id, attempt: row.candidate_attempt,
        result: JSON.parse(row.candidate_result_json), computeMs: row.candidate_compute_ms } : null
    }));
  }

  finalizeVerification({ verificationContext, currentCheck, candidateCheck, now, maxAttempts, mergeResults }) {
    return this.transaction(() => {
      const { jobId, taskId, nodeId, leaseToken, attempt } = verificationContext;
      const job = this.statements.job.get(jobId), task = this.statements.task.get(taskId, jobId);
      const stale = !job || !task || job.status !== 'running' || task.status !== 'leased' ||
        task.node_id !== nodeId || task.lease_token !== leaseToken || task.attempts !== attempt || task.lease_until <= now;
      const currentTiming = currentCheck ? { verificationMs: currentCheck.verificationMs,
        queueWaitMs: currentCheck.queueWaitMs, elapsedMs: currentCheck.elapsedMs } : { verificationMs: 0, queueWaitMs: 0, elapsedMs: 0 };
      if (stale) {
        this.statements.updateResultStatus.run('rejected', currentTiming.verificationMs, currentTiming.queueWaitMs,
          currentTiming.elapsedMs, 'stale-or-expired-attempt', taskId, attempt);
        return { accepted: false, reason: 'stale-lease' };
      }

      const currentStatus = currentCheck.valid ? 'verified' : 'rejected';
      this.statements.updateResultStatus.run(currentStatus, currentTiming.verificationMs, currentTiming.queueWaitMs,
        currentTiming.elapsedMs, currentCheck.valid ? null : 'trusted-recompute-mismatch', taskId, attempt);
      const candidate = this.statements.candidate.get(taskId);
      let acceptedResult = JSON.parse(this.statements.attemptResult.get(taskId, attempt).result_json);
      let acceptedComputeMs = this.statements.attemptResult.get(taskId, attempt).compute_ms;
      if (candidate) {
        const candidateStatus = candidateCheck.valid ? 'verified' : 'rejected';
        this.statements.updateResultStatus.run(candidateStatus, candidateCheck.verificationMs, candidateCheck.queueWaitMs,
          candidateCheck.elapsedMs, candidateCheck.valid ? null : 'trusted-recompute-mismatch', taskId, candidate.attempt);
        if (candidateCheck.valid) { acceptedResult = JSON.parse(candidate.result_json); acceptedComputeMs = candidate.compute_ms; }
        else if (!currentCheck.valid) {
          this.statements.deleteCandidate.run(taskId);
          if (attempt >= maxAttempts) {
            this.statements.failTaskNow.run(taskId, nodeId, leaseToken);
            this.statements.completeJob.run(job.completed_units, 'failed', now, null, 'Repeated unverified results', jobId);
          } else this.statements.releaseTask.run('rejected', taskId, nodeId, leaseToken);
          return { accepted: false, reason: 'unverified-result', verification: { current: currentTiming,
            candidate: { verificationMs: candidateCheck.verificationMs, queueWaitMs: candidateCheck.queueWaitMs, elapsedMs: candidateCheck.elapsedMs } } };
        }
      } else if (!currentCheck.valid) {
        if (attempt >= maxAttempts) {
          this.statements.failTaskNow.run(taskId, nodeId, leaseToken);
          this.statements.completeJob.run(job.completed_units, 'failed', now, null, 'Repeated unverified results', jobId);
        } else this.statements.releaseTask.run('rejected', taskId, nodeId, leaseToken);
        return { accepted: false, reason: 'unverified-result', verification: { current: currentTiming } };
      }

      this.statements.deleteCandidate.run(taskId);
      const changed = this.statements.completeTask.run(JSON.stringify(acceptedResult), acceptedComputeMs, now, taskId, nodeId, leaseToken).changes;
      if (changed !== 1) return { accepted: false, reason: 'stale-lease' };
      const completedUnits = job.completed_units + task.count;
      const done = completedUnits === job.total_units;
      if (completedUnits > job.total_units) throw Error('Completed units exceed job total');
      const merged = done ? mergeResults(this.statements.allResults.all(jobId).map(row => JSON.parse(row.result_json))) : null;
      this.statements.completeJob.run(completedUnits, done ? 'completed' : 'running', done ? now : null,
        done ? JSON.stringify(merged) : null, null, jobId);
      return { accepted: true, verified: true, duplicate: false, jobStatus: done ? 'completed' : 'running',
        verification: { current: currentTiming, ...(candidate ? { candidate: { verificationMs: candidateCheck.verificationMs,
          queueWaitMs: candidateCheck.queueWaitMs, elapsedMs: candidateCheck.elapsedMs } } : {}) } };
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
    const verification = this.statements.resultCounts.get(id);
    const taskVerification = this.statements.verificationTaskCounts.get(id);
    return { id: row.id, workloadId: row.workload_id, params: JSON.parse(row.params_json), status: row.status,
      verificationPolicy: JSON.parse(row.verification_json), verification: { received: verification.received || 0,
        pending: verification.pendingVerification || 0, verified: verification.verified || 0, rejected: verification.rejected || 0,
        accepted: taskVerification.accepted || 0, legacyAccepted: taskVerification.legacyAccepted || 0,
        verificationMs: verification.verification_ms || 0,
        verificationQueueWaitMs: verification.verification_queue_wait_ms || 0,
        verificationElapsedMs: verification.verification_elapsed_ms || 0 },
      totalUnits: row.total_units, allocatedUnits: row.next_unit, completedUnits: row.completed_units,
      remainingUnits: row.total_units - row.completed_units, chunkSize: row.chunk_size,
      tasks: { created: counters.created || 0, pending: counters.pending || 0, leased: counters.leased || 0,
        completed: counters.completed || 0, failed: counters.failed || 0, reassignments: counters.reassignments || 0 },
      createdAt: row.created_at, completedAt: row.completed_at,
      result: row.result_json ? JSON.parse(row.result_json) : null, error: row.error };
  }

  close() { if (this.db.isOpen) this.db.close(); }
}
