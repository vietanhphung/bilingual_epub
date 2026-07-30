import type { Migration } from "./index.js";

export const migration0002UsageLedger: Migration = {
  id: 2,
  name: "usage-ledger",
  up(db) {
    db.exec(`
      CREATE TABLE usage_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        date_key TEXT NOT NULL,
        month_key TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_usage_ledger_date ON usage_ledger(date_key);
      CREATE INDEX idx_usage_ledger_month ON usage_ledger(month_key);
    `);
  },
};
