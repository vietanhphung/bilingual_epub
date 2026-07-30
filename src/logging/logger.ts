import pino from "pino";
import { loadEnv } from "../config/env.js";

const REDACT_PATHS = [
  "apiKey",
  "ANTHROPIC_API_KEY",
  "*.apiKey",
  "*.ANTHROPIC_API_KEY",
  "headers.authorization",
  "headers.Authorization",
  "req.headers.authorization",
];

let cachedLogger: pino.Logger | undefined;

export function getLogger(): pino.Logger {
  if (!cachedLogger) {
    const env = loadEnv();
    const options: pino.LoggerOptions = {
      level: env.LOG_LEVEL,
      redact: {
        paths: REDACT_PATHS,
        censor: "[REDACTED]",
      },
    };
    if (process.env["NODE_ENV"] !== "test") {
      options.transport = {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard" },
      };
    }
    cachedLogger = pino(options);
  }
  return cachedLogger;
}

export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return getLogger().child(bindings);
}
