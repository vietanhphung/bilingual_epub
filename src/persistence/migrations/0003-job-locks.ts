import type { Migration } from "./index.js";

export const migration0003JobLocks: Migration = {
  id: 3,
  name: "job-locks",
  up(db) {
    db.exec(`
      CREATE TABLE job_locks (
        job_id TEXT PRIMARY KEY,
        holder_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
  },
};
