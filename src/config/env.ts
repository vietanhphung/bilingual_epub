import "dotenv/config";
import { envSchema, type AppEnv } from "./schema.js";

let cachedEnv: AppEnv | undefined;

/**
 * Parses process.env once and caches the result. Call resetEnvCache() in
 * tests that mutate process.env between assertions.
 */
export function loadEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = undefined;
}
