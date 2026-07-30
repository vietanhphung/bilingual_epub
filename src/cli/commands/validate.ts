import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { validateEpub } from "../../epub/epub-validator.js";

export function registerValidateCommand(program: Command): void {
  program
    .command("validate <epubPath>")
    .description("Validate a generated EPUB")
    .action(async (epubPath: string) => {
      const buffer = await readFile(epubPath);
      const result = await validateEpub(buffer);
      if (result.valid) {
        console.log(`Valid: ${epubPath}`);
        return;
      }
      console.log(`Invalid: ${epubPath}`);
      for (const issue of result.issues) {
        console.log(`  [${issue.code}] ${issue.message}`);
      }
      process.exitCode = 1;
    });
}
