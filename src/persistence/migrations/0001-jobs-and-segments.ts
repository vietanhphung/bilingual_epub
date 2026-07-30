import type { Migration } from "./index.js";

export const migration0001JobsAndSegments: Migration = {
  id: 1,
  name: "jobs-and-segments",
  up(db) {
    db.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        input_path TEXT NOT NULL,
        output_path TEXT NOT NULL,
        input_checksum TEXT NOT NULL,
        source_language TEXT NOT NULL,
        target_language TEXT NOT NULL,
        display_order TEXT NOT NULL,
        granularity TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        total_segments INTEGER NOT NULL DEFAULT 0,
        completed_segments INTEGER NOT NULL DEFAULT 0,
        failed_segments INTEGER NOT NULL DEFAULT 0,
        accumulated_input_tokens INTEGER NOT NULL DEFAULT 0,
        accumulated_output_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_run_at TEXT,
        next_run_at TEXT,
        error_message TEXT
      );

      CREATE TABLE segments (
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        chapter_path TEXT NOT NULL,
        element_locator TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        source_text TEXT NOT NULL,
        source_html TEXT NOT NULL,
        source_checksum TEXT NOT NULL,
        translated_text TEXT,
        translated_html TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        retry_count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER,
        output_tokens INTEGER,
        error_message TEXT,
        PRIMARY KEY (job_id, id)
      );

      CREATE INDEX idx_segments_job_status ON segments(job_id, status);
      CREATE INDEX idx_segments_job_order ON segments(job_id, order_index);

      CREATE TABLE translation_cache (
        cache_key TEXT PRIMARY KEY,
        translated_text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  },
};
