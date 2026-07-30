import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadEnv } from "../config/env.js";
import { MIGRATIONS } from "./migrations/index.js";

export type AppDatabase = Database.Database;

let cachedDb: AppDatabase | undefined;

function ensureDirectoryExists(path: string): void {
  if (path === ":memory:") return;
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
}

function runMigrations(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT id FROM schema_migrations ORDER BY id")
      .all()
      .map((row) => (row as { id: number }).id),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    const apply = db.transaction(() => {
      migration.up(db);
      db.prepare(
        "INSERT INTO schema_migrations (id, name) VALUES (?, ?)",
      ).run(migration.id, migration.name);
    });
    apply();
  }
}

export function openDatabase(path?: string): AppDatabase {
  const dbPath = path ?? loadEnv().DATABASE_PATH;
  ensureDirectoryExists(dbPath);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

/** Shared singleton for CLI use; tests should call openDatabase() directly with their own path. */
export function getDatabase(): AppDatabase {
  if (!cachedDb) {
    cachedDb = openDatabase();
  }
  return cachedDb;
}

export function closeDatabase(): void {
  cachedDb?.close();
  cachedDb = undefined;
}
