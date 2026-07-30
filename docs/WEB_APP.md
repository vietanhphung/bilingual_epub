# Web app: accounts, uploads, and pay-per-translation

This adds a browser frontend and a multi-user HTTP API on top of the
existing CLI pipeline — the CLI, `src/server`, and `ui/` all call the same
`createJob`/`runJob`/`translatePendingSegments` code, so everything in
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md) (resumability, budgets, the job
state machine, validation) applies unchanged.

```
ui/ (React + Vite, :5173)
  → src/server (Express, :3001)
      → src/app/{create-job,run-job}.ts        (same as the CLI)
      → src/billing/{pricing,entitlement}.ts   (new)
      → Stripe Checkout                        (new)
```

## Running it locally

```bash
npm run server   # API on :3001
npm run ui       # React app on :5173, dev-proxies /api to :3001
```

Minimum `.env` additions (see `.env.example` for the full list):

```env
JWT_SECRET=<openssl rand -hex 32>
LLM_PROVIDER=mock   # or claude, if you want real translations
```

With `LLM_PROVIDER=mock` and no Stripe keys set, you can sign up, upload a
book, and run the *free* translation end-to-end with zero external
dependencies — the paid path fails fast with a clear `STRIPE_NOT_CONFIGURED`
error until you add Stripe keys (see below).

## Accounts and the free translation

Auth is intentionally minimal: email + password, bcrypt-hashed, a
JWT in an httpOnly cookie (`src/server/lib/jwt.ts`,
`src/server/middleware/auth.ts`). No email verification, no OAuth, no
password reset flow — add those before real users sign up with real
passwords.

Every account gets exactly one free translation, tracked by a single
`users.free_translation_used_at` timestamp
(`src/persistence/migrations/0004-users-and-billing.ts`). Eligibility is
re-checked server-side from the database at order-creation time — never
trust a client-supplied "I haven't used my free one yet" — and the row is
written in the same request that creates the job, before the background
run starts.

## Uploads: file, drag-and-drop, or a Drive link

`ui/src/components/UploadDropzone.tsx` handles a native HTML5 drop zone,
a "browse" file input, and a "Google Drive link" tab. All three land on
the same backend behavior (`src/server/lib/store-upload.ts`): the EPUB is
parsed and segmented immediately (reusing `inspectBook`, the same code
`bilingual-epub inspect` uses), so chapter/paragraph/token counts — and
therefore price — are known before the user even picks source/target
language.

**Drive link** support (`src/server/lib/drive.ts`) downloads from a
public "anyone with the link" share URL — no Google OAuth app, no
verification process, ships as-is. It cannot see private files. If you
want a real Drive file picker against private files later, that's a
separate, larger addition: register a Google Cloud OAuth consent screen,
add the Drive Picker JS on the frontend, and store refresh tokens per
user.

## Pricing: per-translation, from the token estimate

You asked specifically about this, so here's the exact mechanism
(`src/billing/pricing.ts`):

```
providerCost = estimateCostUsd(inputTokens, outputTokens)   # existing cost-calculator.ts
charge       = max(PLATFORM_MINIMUM_CHARGE_USD_CENTS, ceil(providerCost * PLATFORM_MARKUP_MULTIPLIER * 100))
```

- **`providerCost`** reuses the CLI's existing, unmodified
  `estimateCostUsd()` (`src/budget/cost-calculator.ts`) — the same
  function `bilingual-epub estimate` already uses. It's driven by
  `MODEL_INPUT_PRICE_PER_MILLION_TOKENS_USD` /
  `MODEL_OUTPUT_PRICE_PER_MILLION_TOKENS_USD`, which **you** set from
  your provider's current pricing page — this codebase deliberately never
  hard-codes a price (see "No hard-coded pricing" in
  `docs/ARCHITECTURE.md`). If you haven't set them, paid translations
  fail fast with `PRICING_NOT_CONFIGURED` rather than silently charging
  $0 or guessing.
- **`PLATFORM_MARKUP_MULTIPLIER`** (default `3`, i.e. 3x provider cost)
  is your margin. It needs to cover: Stripe's own fee (~2.9% + $0.30 per
  charge), the gap between the *estimated* token count you charge for and
  the book's *actual* usage (translation output length varies, and cache
  hits from previously-translated paragraphs can make the real run
  cheaper than estimated — the user is still charged the estimate, so
  padding here is what keeps you from going negative on a given book),
  and whatever margin you actually want to run this as a business.
- **`PLATFORM_MINIMUM_CHARGE_USD_CENTS`** (default 50¢) exists because
  Stripe enforces a real minimum charge (~$0.50 USD) and because a 3-page
  short story shouldn't be a 4¢ Stripe transaction eaten alive by fees.

**Concrete example**, Claude Sonnet-ish pricing ($3/$15 per million
input/output tokens) and a 100k-source-token novel (≈ 400 pages):

```
input:  100,000 tokens × $3 / 1,000,000  = $0.30
output: 120,000 tokens × $15 / 1,000,000 = $1.80
providerCost                             = $2.10
charge = max($0.50, $2.10 × 3)           = $6.30
```

A short story (2,000 source tokens) would price-floor at the $0.50
minimum rather than charging ~13¢.

### Why per-translation instead of the CLI's day/month budget

The CLI's `MAX_INPUT_TOKENS_PER_DAY` / `_PER_MONTH` (see
`docs/ARCHITECTURE.md` → Budget enforcement) exist to protect *your*
provider account from a runaway bill, and they're deliberately small
(100k/day by default) — a paying user's big book would routinely hit that
ceiling and sit in `PAUSED_BUDGET` until the next day, which is exactly
the "wait" you said you want to avoid.

So a paid (or free-grant) order gets its own **per-run** budget sized to
what it's actually expected to use, computed in
`src/server/lib/paid-run-env.ts`:

```ts
maxInputTokensPerRun  = estimatedInputTokens  × 1.5 + requestTokenCap
maxOutputTokensPerRun = estimatedOutputTokens × 1.5 + perRequestOutputCap
maxRequestsPerRun     = ceil(estimatedInputTokens / requestTokenCap) × 1.5 + 5
```

That's enough headroom to run the whole book to completion in one
background pass (`src/server/lib/job-runner.ts`) instead of pausing.
The **day/month** ledger is left alone on purpose — it's the
account-wide safety valve against a genuinely runaway bill across *all*
jobs combined. In production, size it generously (e.g. set it to
whatever daily token spend you're actually comfortable with across your
whole paid user base), since it's no longer the thing rationing any one
user's translation.

## Payment: Stripe Checkout, one-time charge per translation

Stripe is the standard fit here — it's built for exactly this ("charge a
variable, computed-at-request-time amount, once, no subscription"), and
its Checkout product means you don't build or PCI-scope a card form
yourself.

**What was wired up** (`src/server/routes/translations.ts`,
`src/server/routes/billing.ts`, `src/server/routes/billing-webhook.ts`):

1. Order creation computes the price server-side (never trusts the
   client) and creates a Stripe Checkout Session in `mode: "payment"`
   with a dynamic `price_data` line item — no pre-created Stripe Product
   needed, since every translation is a different amount.
2. The user is redirected to Stripe's hosted checkout page, pays, and is
   redirected back to `/orders/:id?checkout=success&session_id=...`.
3. Two independent paths settle the order and start the job
   (`src/server/routes/billing-webhook.ts`, idempotent on order status):
   - **Webhook** (`POST /api/billing/webhook`, `checkout.session.completed`)
     — the source of truth in production. Verified via Stripe's signature
     scheme; the raw request body is preserved for this route specifically
     (mounted before `express.json()` in `src/server/app.ts`).
   - **Reconcile fallback** (`POST /api/billing/reconcile/:sessionId`) —
     called by the frontend right after the success redirect. This exists
     because Stripe can't reach `localhost` without `stripe listen
     --forward-to`, so local dev/demo works without extra setup. In
     production the webhook is what you should actually rely on — a user
     who closes the tab before the redirect completes must not leave an
     order stuck unpaid, and the webhook is what recovers that.

### Setting it up

1. **Create a Stripe account** at [stripe.com](https://stripe.com) (or
   use one you already have). No business verification is needed to use
   *test mode*.
2. **Get test-mode keys**: dashboard.stripe.com/test/apikeys → copy the
   "Secret key" and "Publishable key" into `.env`:
   ```env
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   ```
3. **Forward webhooks to your local server** with the
   [Stripe CLI](https://stripe.com/docs/stripe-cli):
   ```bash
   stripe listen --forward-to localhost:3001/api/billing/webhook
   ```
   It prints a `whsec_...` signing secret — put that in `.env` as
   `STRIPE_WEBHOOK_SECRET`.
4. **Test a payment**: use Stripe's test card `4242 4242 4242 4242`, any
   future expiry, any CVC. The Checkout page is Stripe-hosted, so no card
   data ever touches this app's server.
5. **Go live**: in the Stripe dashboard, activate your account (business
   details, bank account for payouts — Stripe walks you through this),
   switch `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` to the `sk_live_...`
   / `pk_live_...` versions, and create a real webhook endpoint (Developers
   → Webhooks → Add endpoint, pointed at
   `https://yourdomain.com/api/billing/webhook`, subscribed to
   `checkout.session.completed`) to get a live `STRIPE_WEBHOOK_SECRET`.

Stripe's own cut is ~2.9% + $0.30 per successful charge (US card
rates; check your account for exact numbers) — that's part of what
`PLATFORM_MARKUP_MULTIPLIER` needs to cover.

## Known limitations (read before treating this as production-ready)

- **Background job runner is in-process, not durable.** `job-runner.ts`
  drives jobs with an in-memory queue; a server restart mid-run drops the
  in-flight background loop. The job's state in SQLite is still exactly
  as resumable as the CLI leaves it, though — `bilingual-epub run <jobId>`
  or `scheduler start` can pick it back up. At real scale, replace the
  queue with something durable (BullMQ/Redis, or the existing
  `SchedulerService` on a tighter tick).
- **No refund automation.** A job that ends `FAILED` after payment isn't
  automatically refunded — you'd handle that manually via the Stripe
  dashboard or add a webhook-driven refund path.
- **No email verification / password reset.** Fine for a demo or invite-only
  beta; add both before opening signups publicly.
- **Single Node process.** `UploadRepository`/`OrderRepository` and the
  SQLite file are unpartitioned — this is a "run it on one box" design,
  matching the rest of this codebase's local-first philosophy, not a
  horizontally-scaled SaaS backend.
