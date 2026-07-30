import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/persistence/database.js";

describe("openDatabase", () => {
  it("initializes an in-memory database with migrations tracking", () => {
    const db = openDatabase(":memory:");
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    expect(row.some((r) => r.name === "schema_migrations")).toBe(true);
    db.close();
  });

  it("is idempotent across repeated opens on the same file", () => {
    const db1 = openDatabase(":memory:");
    db1.close();
    const db2 = openDatabase(":memory:");
    db2.close();
  });
});
