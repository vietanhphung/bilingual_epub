import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { inspectBook } from "../../app/inspect-book.js";
import { resolveBookConfig, parseDisplayOrderFlag } from "../../config/resolve-book-config.js";
import { AppError } from "../../domain/errors.js";
import { getLogger } from "../../logging/logger.js";

interface InspectOptions {
  source?: string;
  target?: string;
  displayOrder?: string;
}

export function registerInspectCommand(program: Command): void {
  program
    .command("inspect <epubPath>")
    .description("Inspect an EPUB without using API tokens")
    .option("--source <lang>", "source language (en|fr)")
    .option("--target <lang>", "target language (en|fr)")
    .option("--display-order <order>", "english-first|french-first")
    .action(async (epubPath: string, options: InspectOptions) => {
      const logger = getLogger();
      try {
        const config = resolveBookConfig({
          sourceLanguage: options.source,
          targetLanguage: options.target,
          displayOrder: parseDisplayOrderFlag(options.displayOrder),
        });

        const buffer = await readFile(epubPath);
        const report = await inspectBook(buffer);

        console.log(`Input: ${epubPath}`);
        console.log(`Checksum: ${report.inputChecksum}`);
        console.log(
          `Direction: ${config.sourceLanguage} -> ${config.targetLanguage} (${config.displayOrder}, ${config.granularity})`,
        );
        console.log(`Chapters: ${report.chapterCount}`);
        console.log(`Paragraphs: ${report.paragraphCount}`);
        console.log("Paragraphs per chapter:");
        for (const [chapterPath, count] of Object.entries(report.paragraphsByChapter)) {
          console.log(`  ${chapterPath}: ${count}`);
        }
      } catch (err) {
        if (err instanceof AppError) {
          logger.error({ code: err.code }, err.message);
          console.error(`${err.code}: ${err.message}`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    });
}
