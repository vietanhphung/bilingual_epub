import type { AppDatabase } from "../persistence/database.js";

interface LockRow {
  job_id: string;
  holder_id: string;
  acquired_at: string;
  expires_at: string;
}

const DEFAULT_LEASE_MS = 30 * 60 * 1000;

/**
 * SQLite-backed lock so overlapping executions — a second CLI invocation,
 * a scheduler tick racing a manual `run` — can never process the same job
 * at once. Leases expire rather than requiring explicit release, so a
 * process that crashes while holding a lock doesn't block that job
 * forever; it just becomes acquirable again after the lease elapses.
 */
export class DistributedLock {
  constructor(private readonly db: AppDatabase) {}

  tryAcquire(jobId: string, holderId: string, leaseMs: number = DEFAULT_LEASE_MS): boolean {
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresIso = new Date(now.getTime() + leaseMs).toISOString();

    const acquire = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT * FROM job_locks WHERE job_id = ?")
        .get(jobId) as LockRow | undefined;

      if (existing && existing.expires_at > nowIso && existing.holder_id !== holderId) {
        return false;
      }

      this.db
        .prepare(
          `INSERT INTO job_locks (job_id, holder_id, acquired_at, expires_at)
           VALUES (@jobId, @holderId, @acquiredAt, @expiresAt)
           ON CONFLICT(job_id) DO UPDATE SET
             holder_id = excluded.holder_id,
             acquired_at = excluded.acquired_at,
             expires_at = excluded.expires_at`,
        )
        .run({ jobId, holderId, acquiredAt: nowIso, expiresAt: expiresIso });
      return true;
    });

    return acquire();
  }

  release(jobId: string, holderId: string): void {
    this.db
      .prepare("DELETE FROM job_locks WHERE job_id = ? AND holder_id = ?")
      .run(jobId, holderId);
  }
}
