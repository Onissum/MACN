import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Durable worker-side outbox: a computed result reaches disk before it is sent.
// Lease fencing still decides whether a delayed result can be committed.
export class BatchResultSpool {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS spooled_results (
        job_id TEXT NOT NULL, task_id TEXT NOT NULL, node_id TEXT NOT NULL,
        lease_token TEXT NOT NULL, result_json TEXT NOT NULL, compute_ms REAL NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY(job_id, task_id)
      ) STRICT;`);
    this.putStatement = this.db.prepare(`INSERT INTO spooled_results
      (job_id,task_id,node_id,lease_token,result_json,compute_ms,created_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(job_id,task_id) DO UPDATE SET node_id=excluded.node_id, lease_token=excluded.lease_token,
        result_json=excluded.result_json, compute_ms=excluded.compute_ms, created_at=excluded.created_at`);
    this.listStatement = this.db.prepare('SELECT * FROM spooled_results WHERE job_id=? ORDER BY created_at, task_id');
    this.deleteStatement = this.db.prepare('DELETE FROM spooled_results WHERE job_id=? AND task_id=?');
  }
  put(item) {
    this.putStatement.run(item.jobId, item.taskId, item.nodeId, item.leaseToken,
      JSON.stringify(item.result), item.computeMs, item.createdAt ?? Date.now());
  }
  list(jobId) {
    return this.listStatement.all(jobId).map(row => ({ jobId: row.job_id, taskId: row.task_id, nodeId: row.node_id,
      leaseToken: row.lease_token, result: JSON.parse(row.result_json), computeMs: row.compute_ms, createdAt: row.created_at }));
  }
  delete(jobId, taskId) { this.deleteStatement.run(jobId, taskId); }
  close() { if (this.db.isOpen) this.db.close(); }
}
