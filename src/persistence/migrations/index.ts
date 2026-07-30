import type Database from "better-sqlite3";
import { migration0001JobsAndSegments } from "./0001-jobs-and-segments.js";
import { migration0002UsageLedger } from "./0002-usage-ledger.js";
import { migration0003JobLocks } from "./0003-job-locks.js";

export interface Migration {
  id: number;
  name: string;
  up: (db: Database.Database) => void;
}

export const MIGRATIONS: Migration[] = [
  migration0001JobsAndSegments,
  migration0002UsageLedger,
  migration0003JobLocks,
];
