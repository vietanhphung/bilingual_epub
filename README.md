# bilingual-epub-agent

A local, token-budget-aware agent that turns a DRM-free English or French
EPUB into a bilingual EPUB — every source paragraph followed (or preceded)
by its translation, in the same reading order, with the original chapters,
images, links, and styling preserved.

Everything runs on your machine. State lives in a local SQLite database;
the only network calls are to your configured LLM provider, and those are
metered by explicit per-request/run/day/month token (and optional cost)
budgets before any request is sent.

## Requirements

- Node.js 22+
- npm
- An Anthropic API key, if you want real translations (`LLM_PROVIDER=claude`).
  Without one, `LLM_PROVIDER=mock` produces deterministic placeholder
  translations — useful for trying the pipeline end-to-end for free.

## Install

```bash
npm install
npm run build
```

This compiles to `dist/` and produces an executable at
`dist/cli/index.js` (also wired as the `bilingual-epub` bin via
`package.json`). During development you can skip the build step and run
commands directly against the TypeScript source with `npm run dev -- <args>`,
e.g. `npm run dev -- inspect ./book.epub --source fr --target en`.

To install the CLI globally from a local checkout:

```bash
npm link
bilingual-epub --help
```

Docker is not required or provided for the local version 1 — everything
runs as a plain Node process against a local SQLite file.

## Quick start

```bash
# 1. Create .env from .env.example and initialize the local database.
bilingual-epub init

# 2. Edit .env: set ANTHROPIC_API_KEY (or leave LLM_PROVIDER=mock to try
#    the pipeline without any API key / cost).

# 3. See what's in a book without spending any tokens.
bilingual-epub inspect ./book.epub --source fr --target en

# 4. Check scope and (if pricing is configured) estimated cost before
#    translating anything — this makes no translation calls.
bilingual-epub estimate ./book.epub --source fr --target en --preset balanced-daily

# 5. Translate. With --schedule manual (the default), this creates the job
#    and runs it immediately, once, to completion or to a budget pause.
bilingual-epub translate ./book.epub \
  --output ./book-bilingual.epub \
  --source fr --target en \
  --display-order english-first \
  --provider claude

# 6. If it paused (PAUSED_BUDGET / PAUSED_RATE_LIMIT), just run it again —
#    completed paragraphs are never re-translated.
bilingual-epub jobs
bilingual-epub run <job-id>
```

## CLI commands

| Command | What it does |
|---|---|
| `init` | Creates `.env` from `.env.example` (if missing) and initializes the SQLite database. |
| `inspect <epub> --source <lang> --target <lang> [--display-order ...]` | Parses and segments the book, prints chapter/paragraph counts. No API calls. |
| `estimate <epub> --source <lang> --target <lang> [--preset safe-daily\|balanced-daily\|weekly\|custom]` | Dry-run report: chapters, paragraphs, estimated source/output tokens, estimated API calls and scheduled runs, estimated completion date, estimated cost (if pricing is configured), and any paragraphs too large to batch safely. Makes **no** translation calls. |
| `translate <epub> --output <path> --source <lang> --target <lang> [--display-order ...] [--provider claude\|mock] [--schedule manual\|daily\|weekly]` | Creates a job. With `--schedule manual` (default), also runs it immediately. `daily`/`weekly` just create the job — start the scheduler daemon (below) to actually run it. |
| `run <job-id> [--allow-untranslated]` | Runs one bounded processing cycle for an existing job: resumes translation, and renders + writes the output once nothing is pending. `--allow-untranslated` renders with source text standing in for any paragraphs that failed to translate, instead of failing the job. |
| `status <job-id>` | Prints a job's current status, progress, token usage, and (once completed) output/report paths. |
| `jobs` | Lists all jobs. |
| `retry <job-id>` | Resets a job's FAILED segments back to PENDING so the next `run` retries them. |
| `cancel <job-id>` | Cancels a job. |
| `validate <epub>` | Runs the structural validator (packaging rules, manifest/spine integrity, XHTML well-formedness, internal link/anchor resolution) against any EPUB. |
| `scheduler start` | Starts the local cron-based scheduler in the foreground (per `SCHEDULE_MODE`/`SCHEDULE_TIME`/`SCHEDULE_TIMEZONE`/`SCHEDULE_DAY_OF_WEEK`). On each tick, runs every job that's READY or paused. `Ctrl+C` to stop. No-op if `SCHEDULE_MODE=MANUAL`. |

Run any command with `--help` for its full flag list.

## Configuration reference

Configuration is environment-variable based (`.env`, loaded via `dotenv`;
see `.env.example` for the full template with defaults). All values are
validated at startup (Zod) — invalid config fails fast with a clear error.

### Provider

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `claude` | `claude` or `mock`. Provider selection is always explicit config — never inferred or chosen automatically. |
| `LLM_MODEL` | `claude-sonnet-5` | Passed through to the provider untouched. |
| `ANTHROPIC_API_KEY` | — | Required when `LLM_PROVIDER=claude`. Loaded only from the environment; never logged, never hard-coded. |

### Scheduling

| Variable | Default | Notes |
|---|---|---|
| `SCHEDULE_MODE` | `MANUAL` | `MANUAL`, `DAILY`, or `WEEKLY`. |
| `SCHEDULE_TIME` | `02:00` | 24h `HH:mm`, used by `DAILY`/`WEEKLY`. |
| `SCHEDULE_TIMEZONE` | `America/Toronto` | IANA timezone; also the boundary used for daily/monthly token-budget accounting. |
| `SCHEDULE_DAY_OF_WEEK` | `SUN` | `SUN`..`SAT`, used by `WEEKLY`. |

### Budgets (checked, in order, before every batch is sent)

| Variable | Default | Scope |
|---|---|---|
| `MAX_SOURCE_TOKENS_PER_REQUEST` | `8000` | Per request |
| `MAX_ESTIMATED_OUTPUT_TOKENS_PER_REQUEST` | `12000` | Per request |
| `MAX_REQUESTS_PER_RUN` | `10` | Per `run` invocation |
| `MAX_INPUT_TOKENS_PER_RUN` / `MAX_OUTPUT_TOKENS_PER_RUN` | `100000` / `140000` | Per `run` invocation |
| `MAX_INPUT_TOKENS_PER_DAY` / `MAX_OUTPUT_TOKENS_PER_DAY` | `100000` / `140000` | Per calendar day (in `SCHEDULE_TIMEZONE`), across **all** jobs |
| `MAX_INPUT_TOKENS_PER_MONTH` / `MAX_OUTPUT_TOKENS_PER_MONTH` | `2000000` / `2800000` | Per calendar month, across all jobs |
| `TOKEN_SAFETY_MARGIN_PERCENT` | `20` | Reserved off every non-per-request limit above |
| `MAX_RETRIES_PER_SEGMENT` | `3` | Provider-call retry attempts (exponential backoff + jitter) |
| `REQUEST_DELAY_MS` | `1500` | Delay between successive requests within a run |
| `MAX_COST_PER_RUN_USD` / `MAX_COST_PER_DAY_USD` / `MAX_COST_PER_MONTH_USD` | unset | Optional; only enforced once pricing is configured (below) |

These are conservative **application** defaults, not claims about your
provider account's actual limits — tune them to match your plan.

A job that hits a budget mid-run transitions to `PAUSED_BUDGET`
(`PAUSED_RATE_LIMIT` for a provider throttling response) and resumes
exactly where it left off on the next `run`/scheduler tick — no
already-translated paragraph is ever re-sent.

### Cost estimation (optional)

Pricing is **not** hard-coded (provider rates change and vary by
account/tier — baking in a number here would just go stale and mislead
you). Cost estimates and monetary budgets only activate once you set:

```env
MODEL_INPUT_PRICE_PER_MILLION_TOKENS_USD=
MODEL_OUTPUT_PRICE_PER_MILLION_TOKENS_USD=
```

Check your provider's current pricing page and fill these in yourself.
Without them, `estimate` reports cost as "unknown" rather than $0.

### Local paths / misc

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_PATH` | `./data/bilingual-epub.sqlite` | SQLite file for job/segment state and the translation cache. |
| `LOG_LEVEL` | `info` | Pino level. |
| `RUN_LIVE_LLM_TESTS` | `false` | Set `true` to enable the optional live-API smoke test in the test suite. |

### Scheduler presets (used by `estimate --preset` and as a reference for your own `.env`)

| Preset | Requests/run | Max source tokens/request | Input/output tokens per run | Cadence |
|---|---|---|---|---|
| `SAFE_DAILY` | 5 | 8000 | 50,000 / 70,000 | Daily |
| `BALANCED_DAILY` | 10 | 8000 | 100,000 / 140,000 | Daily |
| `WEEKLY` | 25 | 8000 | 250,000 / 350,000 | Weekly |
| `custom` | — | — | — | Uses your `.env` values as-is |

All presets reserve a 20% safety margin.

## How it works

```text
Input EPUB
  → validate archive (zip bomb / path traversal / symlink defenses)
  → safely extract
  → parse container.xml, OPF manifest and spine
  → load XHTML documents in reading order
  → extract translatable blocks (p, li, blockquote, figcaption, h1-h6, td, th)
  → segment into paragraphs with deterministic IDs + inline placeholders
  → persist job + segments (SQLite)
  → batch pending segments within the token budget
  → translate each batch through the configured TranslationStrategy
  → validate the response (ID matching, placeholders, non-identical, ...)
  → cache + persist each outcome
  → render bilingual XHTML (source + translation, in configured order)
  → rebuild the EPUB (mimetype rules preserved)
  → validate the output (structure, manifest/spine, XHTML, internal links)
  → write a JSON processing report next to the output file
```

Key components (see `src/`): `EpubReader`/`EpubWriter`/`EpubValidator`,
`ContentExtractor`/`ParagraphSegmenter`, `TranslationStrategy` (Claude/Mock,
behind one interface — adding a provider never touches EPUB-processing
code), `TranslationOrchestrator`, `JobRepository`/`SegmentRepository`/
`TranslationCache`, `TokenBudgetManager`, `SchedulerService`,
`DistributedLock`. The orchestration layer is an explicit state machine
(`src/domain/job.ts`) — the LLM never decides file paths, scheduling,
paragraph IDs, ordering, or completion.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full pipeline
diagram, component map, job state machine, run sequence, budget
enforcement table, and the design decisions behind them.

## Web app (optional)

A browser frontend and multi-user HTTP API sit alongside the CLI —
`src/server` (Express) wraps the same job pipeline the CLI uses, and `ui/`
(React + Vite) is a drag-and-drop client for it. Accounts get one free
translation; every one after that is priced from the book's estimated
token count and paid for via Stripe Checkout before the job runs. See
[`docs/WEB_APP.md`](docs/WEB_APP.md) for setup, the pricing/entitlement
model, and how to configure Stripe.

```bash
npm run server   # API on :3001 (needs JWT_SECRET set in .env)
npm run ui       # React app on :5173, proxies /api to :3001
```

## Testing

```bash
npm test          # full suite, no paid API calls
npm run typecheck
```

Live-provider smoke tests are opt-in and excluded by default:

```bash
RUN_LIVE_LLM_TESTS=true ANTHROPIC_API_KEY=sk-... npm test
```

## Troubleshooting

- **`AUTHENTICATION: ...`** — `ANTHROPIC_API_KEY` is missing or invalid.
  The job fails immediately rather than retrying (retrying a bad key
  indefinitely wastes time and can trigger provider lockouts). Fix the
  key and `retry <job-id>` then `run <job-id>`.
- **Job stuck at `PAUSED_BUDGET`** — expected: the next batch didn't fit
  in a request/run/day/month budget. Just `run <job-id>` again (a new
  run gets a fresh per-run budget), or wait for the next scheduler tick.
- **Job stuck at `PAUSED_RATE_LIMIT`** — the provider throttled the
  request after exhausting the built-in retry/backoff. `run <job-id>`
  again once the rate limit window has likely passed.
- **`UNSUPPORTED_LANGUAGE`** — only `en`/`fr` are supported in v1, and
  `--source`/`--target` must differ.
- **`INVALID_EPUB` / `UNSAFE_ARCHIVE`** — the file isn't a valid EPUB, is
  corrupt, or tripped a safety check (path traversal, oversized/too many
  entries, symlink entry, etc). DRM-protected EPUBs are not supported and
  will fail extraction/parsing.
- **Job `FAILED` with "N segment(s) failed to translate"** — some
  paragraphs couldn't be translated/validated after retries. Inspect the
  `<output>.report.json` failure summary, then either `retry <job-id>`
  or re-run with `--allow-untranslated` to render with source text in
  their place.
- **`bilingual-epub: command not found` after `npm link`** — make sure
  `npm run build` succeeded first (the bin points at `dist/cli/index.js`).

## Version 1 non-goals

PDF/MOBI input or conversion, DRM removal, sentence/page-level alignment,
languages beyond English/French, a translation-editing UI, a cloud job
queue, in-EPUB JavaScript language toggles, OCR, image translation, audio
generation, and automatic publication/distribution. (A browser frontend
and multi-user accounts, originally listed here too, now exist — see
"Web app" above.) See `bilingual_epub_agent_build_plan.md` for the full
build plan the core pipeline implementation follows.
