#!/usr/bin/env node
import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerInspectCommand } from "./commands/inspect.js";
import { registerJobCommands } from "./commands/jobs.js";
import { registerValidateCommand } from "./commands/validate.js";
import { registerEstimateCommand } from "./commands/estimate.js";
import { registerSchedulerCommand } from "./commands/scheduler.js";
import { registerStubCommands } from "./commands/stubs.js";

const program = new Command();

program
  .name("bilingual-epub")
  .description("Local bilingual EPUB generation agent (English <-> French)")
  .version("0.1.0");

registerInitCommand(program);
registerInspectCommand(program);
registerJobCommands(program);
registerValidateCommand(program);
registerEstimateCommand(program);
registerSchedulerCommand(program);
registerStubCommands(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
