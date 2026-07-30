import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { AppDatabase } from "../../persistence/database.js";
import type { AppEnv } from "../../config/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { storeUpload } from "../lib/store-upload.js";
import { downloadFromDriveLink } from "../lib/drive.js";
import { priceTranslationUsd } from "../../billing/pricing.js";
import { isEligibleForFreeTranslation } from "../../billing/entitlement.js";
import { PricingNotConfiguredError } from "../../domain/errors.js";
import type { Upload } from "../../persistence/upload-repository.js";
import type { User } from "../../persistence/user-repository.js";

function uploadResponse(env: AppEnv, user: User, upload: Upload) {
  const eligibleForFree = isEligibleForFreeTranslation(user);
  let amountUsdCents: number | null = null;
  let pricingUnavailable = false;
  if (!eligibleForFree) {
    try {
      amountUsdCents = priceTranslationUsd(
        env,
        upload.sourceTokenEstimate,
        upload.estimatedOutputTokens,
      ).amountUsdCents;
    } catch (err) {
      if (err instanceof PricingNotConfiguredError) {
        pricingUnavailable = true;
      } else {
        throw err;
      }
    }
  }
  return {
    upload: {
      id: upload.id,
      originalFilename: upload.originalFilename,
      chapterCount: upload.chapterCount,
      paragraphCount: upload.paragraphCount,
      sourceTokenEstimate: upload.sourceTokenEstimate,
      estimatedOutputTokens: upload.estimatedOutputTokens,
    },
    eligibleForFree,
    amountUsdCents,
    pricingUnavailable,
  };
}

export function uploadsRouter(db: AppDatabase, env: AppEnv): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.UPLOAD_MAX_BYTES },
  });

  router.post("/", requireAuth, upload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "NO_FILE", message: "Attach an .epub file as 'file'." });
        return;
      }
      const record = await storeUpload(db, env, {
        userId: req.user!.id,
        originalFilename: req.file.originalname,
        buffer: req.file.buffer,
        source: "FILE",
      });
      res.status(201).json(uploadResponse(env, req.user!, record));
    } catch (err) {
      next(err);
    }
  });

  const driveLinkSchema = z.object({ url: z.string().url() });

  router.post("/from-drive-link", requireAuth, async (req, res, next) => {
    try {
      const parsed = driveLinkSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_INPUT", message: "A valid Drive share URL is required." });
        return;
      }
      const buffer = await downloadFromDriveLink(env, parsed.data.url);
      const record = await storeUpload(db, env, {
        userId: req.user!.id,
        originalFilename: parsed.data.url.split("/").pop() ?? "drive-import.epub",
        buffer,
        source: "DRIVE_LINK",
      });
      res.status(201).json(uploadResponse(env, req.user!, record));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
