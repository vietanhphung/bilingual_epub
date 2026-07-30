import { randomUUID } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { AppDatabase } from "../../persistence/database.js";
import type { AppEnv } from "../../config/schema.js";
import { UserRepository } from "../../persistence/user-repository.js";
import { signSessionToken, SESSION_COOKIE_NAME } from "../lib/jwt.js";
import { requireAuth } from "../middleware/auth.js";
import type { User } from "../../persistence/user-repository.js";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    freeTranslationAvailable: user.freeTranslationUsedAt === null,
  };
}

function setSessionCookie(res: import("express").Response, env: AppEnv, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.WEB_APP_ORIGIN.startsWith("https://"),
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function authRouter(db: AppDatabase, env: AppEnv): Router {
  const router = Router();
  const users = new UserRepository(db);

  router.post("/signup", async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_INPUT", message: parsed.error.issues[0]?.message });
      return;
    }
    const { email, password } = parsed.data;
    if (users.findByEmail(email)) {
      res.status(409).json({ error: "EMAIL_TAKEN", message: "An account with that email already exists." });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = users.create({ id: randomUUID(), email, passwordHash });
    const token = signSessionToken(env, user.id);
    setSessionCookie(res, env, token);
    res.status(201).json({ user: publicUser(user) });
  });

  router.post("/login", async (req, res) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_INPUT", message: parsed.error.issues[0]?.message });
      return;
    }
    const { email, password } = parsed.data;
    const user = users.findByEmail(email);
    const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !valid) {
      res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Wrong email or password." });
      return;
    }
    const token = signSessionToken(env, user.id);
    setSessionCookie(res, env, token);
    res.json({ user: publicUser(user) });
  });

  router.post("/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    res.status(204).end();
  });

  router.get("/me", requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user!) });
  });

  return router;
}
