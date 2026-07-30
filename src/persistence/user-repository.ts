import type { AppDatabase } from "./database.js";
import { AppError } from "../domain/errors.js";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  freeTranslationUsedAt: string | null;
  stripeCustomerId: string | null;
  createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  free_translation_used_at: string | null;
  stripe_customer_id: string | null;
  created_at: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    freeTranslationUsedAt: row.free_translation_used_at,
    stripeCustomerId: row.stripe_customer_id,
    createdAt: row.created_at,
  };
}

export interface CreateUserInput {
  id: string;
  email: string;
  passwordHash: string;
}

export class UserRepository {
  constructor(private readonly db: AppDatabase) {}

  create(input: CreateUserInput): User {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO users (id, email, password_hash, free_translation_used_at, stripe_customer_id, created_at)
         VALUES (@id, @email, @passwordHash, NULL, NULL, @now)`,
      )
      .run({ ...input, email: input.email.toLowerCase(), now });
    return this.getOrThrow(input.id);
  }

  get(id: string): User | undefined {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      | UserRow
      | undefined;
    return row ? rowToUser(row) : undefined;
  }

  getOrThrow(id: string): User {
    const user = this.get(id);
    if (!user) throw new AppError(`User not found: ${id}`, "USER_NOT_FOUND");
    return user;
  }

  findByEmail(email: string): User | undefined {
    const row = this.db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email.toLowerCase()) as UserRow | undefined;
    return row ? rowToUser(row) : undefined;
  }

  markFreeTranslationUsed(id: string): User {
    this.db
      .prepare("UPDATE users SET free_translation_used_at = @now WHERE id = @id")
      .run({ id, now: new Date().toISOString() });
    return this.getOrThrow(id);
  }

  setStripeCustomerId(id: string, stripeCustomerId: string): User {
    this.db
      .prepare("UPDATE users SET stripe_customer_id = @stripeCustomerId WHERE id = @id")
      .run({ id, stripeCustomerId });
    return this.getOrThrow(id);
  }
}
