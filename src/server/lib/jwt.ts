import jwt from "jsonwebtoken";
import type { AppEnv } from "../../config/schema.js";

export const SESSION_COOKIE_NAME = "beb_session";
const SESSION_TTL = "30d";

export function signSessionToken(env: AppEnv, userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: SESSION_TTL });
}

export function verifySessionToken(env: AppEnv, token: string): string | undefined {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload === "object" && typeof payload.sub === "string") {
      return payload.sub;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
