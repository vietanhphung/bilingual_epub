import { existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { openDatabase } from "../../persistence/database.js";
import { getLogger } from "../../logging/logger.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize local configuration and database")
    .action(() => {
      const logger = getLogger();
      const envPath = resolve(process.cwd(), ".env");
      const envExamplePath = resolve(process.cwd(), ".env.example");

      if (!existsSync(envPath) && existsSync(envExamplePath)) {
        copyFileSync(envExamplePath, envPath);
        logger.info({ envPath }, "Created .env from .env.example");
      } else if (existsSync(envPath)) {
        logger.info({ envPath }, ".env already exists, leaving untouched");
      }

      const db = openDatabase();
      db.close();
      logger.info("Database initialized");
      console.log(
        "Initialized. Edit .env to set ANTHROPIC_API_KEY and other settings.",
      );
    });
}
