import type { AppDatabase } from "./database.js";
import { AppError } from "../domain/errors.js";
import type { DisplayOrder, SupportedLanguage } from "../domain/translation.js";

export type OrderStatus =
  | "FREE_GRANTED"
  | "AWAITING_PAYMENT"
  | "PAID"
  | "PAYMENT_FAILED"
  | "CANCELLED";

export interface TranslationOrder {
  id: string;
  userId: string;
  uploadId: string;
  jobId: string | null;
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  displayOrder: DisplayOrder;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  amountUsdCents: number;
  isFree: boolean;
  status: OrderStatus;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OrderRow {
  id: string;
  user_id: string;
  upload_id: string;
  job_id: string | null;
  source_language: string;
  target_language: string;
  display_order: string;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  amount_usd_cents: number;
  is_free: number;
  status: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

function rowToOrder(row: OrderRow): TranslationOrder {
  return {
    id: row.id,
    userId: row.user_id,
    uploadId: row.upload_id,
    jobId: row.job_id,
    sourceLanguage: row.source_language as SupportedLanguage,
    targetLanguage: row.target_language as SupportedLanguage,
    displayOrder: row.display_order as DisplayOrder,
    estimatedInputTokens: row.estimated_input_tokens,
    estimatedOutputTokens: row.estimated_output_tokens,
    amountUsdCents: row.amount_usd_cents,
    isFree: row.is_free === 1,
    status: row.status as OrderStatus,
    stripeCheckoutSessionId: row.stripe_checkout_session_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateOrderInput {
  id: string;
  userId: string;
  uploadId: string;
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  displayOrder: DisplayOrder;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  amountUsdCents: number;
  isFree: boolean;
  status: OrderStatus;
  stripeCheckoutSessionId?: string | undefined;
}

export class OrderRepository {
  constructor(private readonly db: AppDatabase) {}

  create(input: CreateOrderInput): TranslationOrder {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO translation_orders (
          id, user_id, upload_id, job_id, source_language, target_language, display_order,
          estimated_input_tokens, estimated_output_tokens, amount_usd_cents, is_free, status,
          stripe_checkout_session_id, stripe_payment_intent_id, error_message, created_at, updated_at
        ) VALUES (@id, @userId, @uploadId, NULL, @sourceLanguage, @targetLanguage, @displayOrder,
          @estimatedInputTokens, @estimatedOutputTokens, @amountUsdCents, @isFree, @status,
          @stripeCheckoutSessionId, NULL, NULL, @now, @now)`,
      )
      .run({
        ...input,
        isFree: input.isFree ? 1 : 0,
        stripeCheckoutSessionId: input.stripeCheckoutSessionId ?? null,
        now,
      });
    return this.getOrThrow(input.id);
  }

  get(id: string): TranslationOrder | undefined {
    const row = this.db
      .prepare("SELECT * FROM translation_orders WHERE id = ?")
      .get(id) as OrderRow | undefined;
    return row ? rowToOrder(row) : undefined;
  }

  getOrThrow(id: string): TranslationOrder {
    const order = this.get(id);
    if (!order) throw new AppError(`Order not found: ${id}`, "ORDER_NOT_FOUND");
    return order;
  }

  findByStripeSessionId(sessionId: string): TranslationOrder | undefined {
    const row = this.db
      .prepare("SELECT * FROM translation_orders WHERE stripe_checkout_session_id = ?")
      .get(sessionId) as OrderRow | undefined;
    return row ? rowToOrder(row) : undefined;
  }

  listByUser(userId: string): TranslationOrder[] {
    const rows = this.db
      .prepare("SELECT * FROM translation_orders WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId) as OrderRow[];
    return rows.map(rowToOrder);
  }

  setStripeSession(id: string, stripeCheckoutSessionId: string): TranslationOrder {
    this.db
      .prepare(
        "UPDATE translation_orders SET stripe_checkout_session_id = @stripeCheckoutSessionId, updated_at = @now WHERE id = @id",
      )
      .run({ id, stripeCheckoutSessionId, now: new Date().toISOString() });
    return this.getOrThrow(id);
  }

  markPaid(id: string, stripePaymentIntentId: string | null): TranslationOrder {
    this.db
      .prepare(
        `UPDATE translation_orders SET status = 'PAID', stripe_payment_intent_id = @stripePaymentIntentId,
         updated_at = @now WHERE id = @id`,
      )
      .run({ id, stripePaymentIntentId, now: new Date().toISOString() });
    return this.getOrThrow(id);
  }

  attachJob(id: string, jobId: string): TranslationOrder {
    this.db
      .prepare("UPDATE translation_orders SET job_id = @jobId, updated_at = @now WHERE id = @id")
      .run({ id, jobId, now: new Date().toISOString() });
    return this.getOrThrow(id);
  }

  markStatus(id: string, status: OrderStatus, errorMessage?: string | undefined): TranslationOrder {
    this.db
      .prepare(
        "UPDATE translation_orders SET status = @status, error_message = @errorMessage, updated_at = @now WHERE id = @id",
      )
      .run({ id, status, errorMessage: errorMessage ?? null, now: new Date().toISOString() });
    return this.getOrThrow(id);
  }
}
