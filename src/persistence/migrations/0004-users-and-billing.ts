import type { Migration } from "./index.js";

export const migration0004UsersAndBilling: Migration = {
  id: 4,
  name: "users-and-billing",
  up(db) {
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        free_translation_used_at TEXT,
        stripe_customer_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE uploads (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        original_filename TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        source TEXT NOT NULL,
        input_checksum TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        chapter_count INTEGER NOT NULL,
        paragraph_count INTEGER NOT NULL,
        source_token_estimate INTEGER NOT NULL,
        estimated_output_tokens INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_uploads_user ON uploads(user_id);

      CREATE TABLE translation_orders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        upload_id TEXT NOT NULL REFERENCES uploads(id),
        job_id TEXT REFERENCES jobs(id),
        source_language TEXT NOT NULL,
        target_language TEXT NOT NULL,
        display_order TEXT NOT NULL,
        estimated_input_tokens INTEGER NOT NULL,
        estimated_output_tokens INTEGER NOT NULL,
        amount_usd_cents INTEGER NOT NULL,
        is_free INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        stripe_checkout_session_id TEXT,
        stripe_payment_intent_id TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_orders_user ON translation_orders(user_id);
      CREATE INDEX idx_orders_stripe_session ON translation_orders(stripe_checkout_session_id);

      ALTER TABLE jobs ADD COLUMN user_id TEXT;
      CREATE INDEX idx_jobs_user ON jobs(user_id);
    `);
  },
};
