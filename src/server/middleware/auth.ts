import type { NextFunction, Request, Response } from "express";
import type { AppDatabase } from "../../persistence/database.js";
import type { AppEnv } from "../../config/schema.js";
import { UserRepository } from "../../persistence/user-repository.js";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../lib/jwt.js";

/** Attaches req.user when a valid session cookie is present; never rejects. */
export function attachUser(db: AppDatabase, env: AppEnv) {
  const users = new UserRepository(db);
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (typeof token === "string") {
      const userId = verifySessionToken(env, token);
      const found = userId ? users.get(userId) : undefined;
      if (found) {
        req.user = found;
      }
    }
    next();
  };
}

/** Rejects with 401 unless attachUser already found a valid session. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "AUTHENTICATION_REQUIRED", message: "Sign in first." });
    return;
  }
  next();
}
