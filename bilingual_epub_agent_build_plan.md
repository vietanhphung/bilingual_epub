# Local Bilingual EPUB Agent — Build Plan for Claude Code

You are a senior TypeScript engineer. Build the first version of a local bilingual EPUB generation agent.

The application accepts a DRM-free EPUB containing either English or French and produces a new EPUB containing both languages.

Do not implement everything at once. Work milestone by milestone, write tests before or alongside implementation, and stop after each milestone to show:

1. Files created or modified
2. Important design decisions
3. Tests added
4. Commands to run
5. Remaining limitations

Do not silently change architecture. Ask before introducing a database server, cloud storage, frontend framework, or paid service beyond the selected LLM provider.

## 1. Product requirements

Input:
- One local `.epub` file
- Supported source languages in version 1:
  - English
  - French
- DRM-protected EPUBs are not supported

Output:
- One valid bilingual `.epub` file
- Each source paragraph is followed or preceded by its translation
- Paragraphs must remain aligned one-to-one
- Original chapter order, images, links, headings, emphasis, and basic styling should be preserved where possible

Supported language directions:
- French → English
- English → French

Display-order setting:
- `ENGLISH_FIRST`
- `FRENCH_FIRST`

Granularity in version 1:
- `PARAGRAPH` only
- Exactly one English paragraph paired with exactly one French paragraph
- Do not implement sentence-level or page-level alignment
- EPUBs are reflowable, so do not implement fixed page-by-page alignment

Example output for `ENGLISH_FIRST`:

```html
<div class="bilingual-pair">
  <p class="translation-en" lang="en">
    It was still dark when she left the house.
  </p>
  <p class="translation-fr" lang="fr">
    Il faisait encore nuit lorsqu’elle quitta la maison.
  </p>
</div>
```

Example output for `FRENCH_FIRST`:

```html
<div class="bilingual-pair">
  <p class="translation-fr" lang="fr">
    Il faisait encore nuit lorsqu’elle quitta la maison.
  </p>
  <p class="translation-en" lang="en">
    It was still dark when she left the house.
  </p>
</div>
```

## 2. Technology stack

Use:

- Node.js 22+
- TypeScript with strict mode
- npm
- SQLite for local job state and translation cache
- Vitest for testing
- Zod for configuration and API-response validation
- Cheerio or an XML-safe XHTML parser
- A ZIP library that supports controlling entry order and compression
- Commander for the CLI
- node-cron for local daily or weekly scheduling
- Pino for structured logging
- dotenv for local environment variables

Prefer simple libraries and avoid unnecessary frameworks.

The EPUB writer must preserve EPUB packaging rules:
- `mimetype` must be the first ZIP entry
- `mimetype` must be stored without compression
- all referenced manifest files must exist
- XHTML must remain valid
- internal paths and anchors must resolve

## 3. Architecture

Use a deterministic pipeline:

```text
Input EPUB
  → validate archive
  → safely extract
  → parse container.xml
  → parse OPF manifest and spine
  → load XHTML documents in reading order
  → identify translatable blocks
  → create paragraph segments
  → count estimated/provider tokens
  → select segments within current budget
  → translate through TranslationStrategy
  → validate one-to-one results
  → persist translations and progress
  → render bilingual XHTML
  → rebuild EPUB
  → validate output
  → produce processing report
```

Create these major components:

1. EpubReader
2. EpubWriter
3. EpubValidator
4. ContentExtractor
5. ParagraphSegmenter
6. TranslationStrategy
7. TranslationOrchestrator
8. TranslationValidator
9. TranslationCache
10. JobRepository
11. TokenBudgetManager
12. SchedulerService
13. BilingualRenderer
14. CLI commands

The orchestration layer may be called an agent, but it must use an explicit state machine. The LLM must not decide file paths, scheduling, paragraph IDs, ordering, or whether processing is complete.

## 4. Strategy pattern for LLM providers

Create a provider-independent interface:

```ts
interface TranslationStrategy {
  readonly provider: string;
  readonly model: string;

  countTokens(
    request: TranslationBatchRequest
  ): Promise<TokenEstimate>;

  translateBatch(
    request: TranslationBatchRequest
  ): Promise<TranslationBatchResult>;
}

interface TranslationSegmentRequest {
  id: string;
  sourceLanguage: "en" | "fr";
  targetLanguage: "en" | "fr";
  text: string;
  protectedPlaceholders: string[];
}

interface TranslationBatchRequest {
  segments: TranslationSegmentRequest[];
}

interface TranslationSegmentResult {
  id: string;
  translatedText: string;
}

interface TranslationBatchResult {
  translations: TranslationSegmentResult[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

interface TokenEstimate {
  inputTokens: number;
  estimatedOutputTokens: number;
}
```

Implement:

1. `ClaudeTranslationStrategy`
2. `MockTranslationStrategy`

Prepare interfaces for later providers, but do not implement all of them in version 1:

- `OpenAITranslationStrategy`
- `GeminiTranslationStrategy`
- `LocalModelTranslationStrategy`

Provider selection must come from configuration:

```env
LLM_PROVIDER=claude
LLM_MODEL=<configured model>
ANTHROPIC_API_KEY=<secret>
```

Never hard-code the API key or a model name in domain code.

Provider-specific SDK types must not leak outside the provider adapter.

## 5. Translation contract

Translate for semantic accuracy and natural reading while preserving:

- paragraph boundaries
- names
- dialogue
- punctuation where appropriate
- numbers
- dates
- URLs
- inline placeholders
- footnote markers

The API request must use stable segment IDs.

Request example:

```json
{
  "segments": [
    {
      "id": "chapter-001-paragraph-0001",
      "text": "Il faisait encore nuit.",
      "sourceLanguage": "fr",
      "targetLanguage": "en",
      "protectedPlaceholders": []
    }
  ]
}
```

Expected response:

```json
{
  "translations": [
    {
      "id": "chapter-001-paragraph-0001",
      "translatedText": "It was still dark."
    }
  ]
}
```

Validation rules:
- Every requested ID appears exactly once
- No unexpected ID appears
- Translation cannot be blank
- Source and translation cannot be accidentally identical, except for names, numbers, URLs, or genuinely language-neutral text
- Protected placeholders must all remain present
- One source paragraph must produce one translated paragraph
- Invalid results must not be written as completed
- Retry failed segments separately
- Never rely only on response array position

Use structured output or strict JSON validated with Zod.

Set translation randomness low. Do not enable extended reasoning for ordinary translation.

## 6. XHTML and inline formatting

Version 1 translatable block elements:

- `p`
- `li`
- `blockquote`
- `figcaption`
- `h1` through `h6`
- `td`
- `th`

Do not translate:

- `script`
- `style`
- `code`
- `pre`
- `svg`
- `math`
- hidden elements
- empty or whitespace-only elements

Preserve inline formatting through placeholders.

Example source:

```html
<p>
  Il regarda <em>la mer</em> pendant plusieurs minutes.
</p>
```

Temporary translation representation:

```text
Il regarda <x-inline data-id="inline-1">la mer</x-inline>
pendant plusieurs minutes.
```

The provider must preserve the placeholder.

Reconstruct translated XHTML:

```html
<p lang="en">
  He looked at <em>the sea</em> for several minutes.
</p>
```

If safe inline reconstruction cannot be completed:
- retain the source paragraph
- mark the segment failed
- do not generate malformed XHTML

Each segment must have a deterministic ID based on:
- EPUB content file
- element position or stable element ID
- normalized source text checksum

## 7. Display settings

```ts
type SupportedLanguage = "en" | "fr";
type DisplayOrder = "ENGLISH_FIRST" | "FRENCH_FIRST";
type Granularity = "PARAGRAPH";
```

Configuration:

```json
{
  "sourceLanguage": "fr",
  "targetLanguage": "en",
  "displayOrder": "ENGLISH_FIRST",
  "granularity": "PARAGRAPH"
}
```

Rules:
- `sourceLanguage` and `targetLanguage` must be different
- only en/fr combinations are accepted
- display order affects rendering only
- display order must not affect translation direction
- version 1 must reject unsupported languages and granularities with clear errors

Default settings:
- Source language: explicit user selection
- Display order: `ENGLISH_FIRST`
- Granularity: `PARAGRAPH`

Do not rely exclusively on automatic language detection. Optional detection may warn that the selected language appears incorrect, but explicit configuration remains authoritative.

## 8. Job state and resumability

Use SQLite.

Job statuses:

- `CREATED`
- `EXTRACTING`
- `SEGMENTING`
- `READY`
- `TRANSLATING`
- `PAUSED_BUDGET`
- `PAUSED_RATE_LIMIT`
- `RENDERING`
- `VALIDATING`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

Persist:

Job:
- id
- inputPath
- outputPath
- inputChecksum
- sourceLanguage
- targetLanguage
- displayOrder
- granularity
- provider
- model
- status
- totalSegments
- completedSegments
- failedSegments
- accumulatedInputTokens
- accumulatedOutputTokens
- estimatedCost
- createdAt
- updatedAt
- lastRunAt
- nextRunAt
- errorMessage

Segment:
- id
- jobId
- chapterPath
- elementLocator
- orderIndex
- sourceText
- sourceHtml
- sourceChecksum
- translatedText
- translatedHtml
- status
- retryCount
- inputTokens
- outputTokens
- errorMessage

The application must resume after process termination without retranslating completed segments.

Cache key:

```text
SHA-256(
  sourceLanguage +
  targetLanguage +
  provider +
  model +
  translationPromptVersion +
  normalizedSourceText
)
```

## 9. Token- and cost-aware scheduler

Support:

- `MANUAL`
- `DAILY`
- `WEEKLY`

Scheduling must never be the only protection against excessive usage.

Before each request:

1. Count or estimate input tokens
2. Estimate expected output tokens
3. Check per-request limits
4. Check per-run token budget
5. Check daily token budget
6. Check monthly token budget
7. Check optional monetary budget
8. Reserve a safety margin
9. Submit only batches that fit
10. Pause cleanly when the next batch does not fit

Configuration:

```env
SCHEDULE_MODE=MANUAL
SCHEDULE_TIME=02:00
SCHEDULE_TIMEZONE=America/Toronto
SCHEDULE_DAY_OF_WEEK=SUN

MAX_SOURCE_TOKENS_PER_REQUEST=8000
MAX_ESTIMATED_OUTPUT_TOKENS_PER_REQUEST=12000

MAX_REQUESTS_PER_RUN=10
MAX_INPUT_TOKENS_PER_RUN=100000
MAX_OUTPUT_TOKENS_PER_RUN=140000

MAX_INPUT_TOKENS_PER_DAY=100000
MAX_OUTPUT_TOKENS_PER_DAY=140000

MAX_INPUT_TOKENS_PER_MONTH=2000000
MAX_OUTPUT_TOKENS_PER_MONTH=2800000

TOKEN_SAFETY_MARGIN_PERCENT=20
MAX_RETRIES_PER_SEGMENT=3
REQUEST_DELAY_MS=1500
```

Optional:

```env
MAX_COST_PER_RUN_USD=
MAX_COST_PER_DAY_USD=
MAX_COST_PER_MONTH_USD=
```

These are conservative application defaults, not claims about provider account limits. Make them easy to change.

Recommended behavior:
- Manual mode is the default for version 1
- Daily mode runs once per day and processes until a run budget is reached
- Weekly mode runs once per week and may use a larger configured run budget
- A paused job resumes at the next scheduled execution
- The scheduler must use a local lock so overlapping executions cannot process the same job
- A second application instance must not duplicate a running job
- Rate-limit responses should use exponential backoff with jitter
- Honor provider retry-after headers where available
- Authentication, invalid-request, and exhausted-credit errors should not be retried indefinitely

Batch construction:
- never split a paragraph
- stop adding paragraphs before the request budget is exceeded
- prefer approximately 4,000–8,000 source tokens per request
- keep chapters separate when practical
- reserve 20% of the request budget for response variability and formatting overhead
- do not send an entire book in one context window even if the model technically allows it

Use the provider token-counting API when supported. Otherwise use a clearly labeled local estimate.

Actual response usage must replace estimates in accounting.

## 10. Scheduler presets

Implement presets:

### SAFE_DAILY
- 5 requests per run
- 8,000 maximum source tokens per request
- 50,000 maximum input tokens per run
- 70,000 maximum output tokens per run
- 20% safety margin
- once daily

### BALANCED_DAILY
- 10 requests per run
- 8,000 maximum source tokens per request
- 100,000 maximum input tokens per run
- 140,000 maximum output tokens per run
- 20% safety margin
- once daily

### WEEKLY
- 25 requests per run
- 8,000 maximum source tokens per request
- 250,000 maximum input tokens per run
- 350,000 maximum output tokens per run
- 20% safety margin
- once weekly

### CUSTOM
- user supplies all budgets

These presets are application safety limits. The application must still respect real provider rate limits and account configuration.

Provide a dry-run command that reports:

- number of chapters
- number of paragraphs
- source-language token estimate
- estimated translation output tokens
- estimated number of API calls
- estimated number of scheduled runs
- estimated completion date
- estimated cost, when current model pricing is configured
- paragraphs that cannot be processed safely

Dry run must make no translation calls.

## 11. CLI

Initialize configuration:

```bash
bilingual-epub init
```

Inspect without API usage:

```bash
bilingual-epub inspect ./book.epub \
  --source fr \
  --target en \
  --display-order english-first
```

Create and optionally run a job:

```bash
bilingual-epub translate ./book.epub \
  --output ./book-bilingual.epub \
  --source fr \
  --target en \
  --display-order english-first \
  --provider claude \
  --schedule manual
```

Run one bounded processing cycle:

```bash
bilingual-epub run <job-id>
```

Start the local scheduler:

```bash
bilingual-epub scheduler start
```

Show progress:

```bash
bilingual-epub status <job-id>
```

List jobs:

```bash
bilingual-epub jobs
```

Retry failed segments:

```bash
bilingual-epub retry <job-id>
```

Cancel a job:

```bash
bilingual-epub cancel <job-id>
```

Validate output:

```bash
bilingual-epub validate ./book-bilingual.epub
```

Dry run:

```bash
bilingual-epub estimate ./book.epub \
  --source fr \
  --target en \
  --preset balanced-daily
```

## 12. Security

Treat EPUBs as untrusted ZIP archives.

Protect against:
- ZIP path traversal
- ZIP bombs
- excessive archive entries
- excessive decompressed size
- XML external entity attacks
- embedded scripts
- malformed XHTML
- unexpected absolute paths
- symlinks
- output overwrite without confirmation

Default limits:
- maximum input EPUB size: 100 MB
- maximum decompressed size: 500 MB
- maximum ZIP entries: 10,000
- processing timeout per stage
- API keys loaded only from environment variables
- logs must never contain API keys or complete book contents
- temporary files removed after successful completion
- failed-job temporary files retained only when debug mode is enabled

## 13. Output CSS

Add a dedicated stylesheet without unnecessarily replacing the original CSS:

```css
.bilingual-pair {
  margin: 0 0 1.25em 0;
  break-inside: avoid;
}

.bilingual-pair > [lang="en"],
.bilingual-pair > [lang="fr"] {
  margin-top: 0;
  margin-bottom: 0.4em;
}

.translation-secondary {
  opacity: 0.86;
}
```

Use document order, not CSS-only reordering, to implement `ENGLISH_FIRST` or `FRENCH_FIRST`.

Do not use JavaScript language toggles in version 1 because EPUB-reader JavaScript support is inconsistent.

## 14. Error handling

Create typed application errors:

- `InvalidEpubError`
- `UnsupportedLanguageError`
- `UnsupportedGranularityError`
- `UnsafeArchiveError`
- `ManifestResolutionError`
- `TranslationProviderError`
- `TranslationValidationError`
- `TokenBudgetExceededError`
- `RateLimitError`
- `AuthenticationError`
- `OutputValidationError`

A single paragraph failure should not necessarily fail the whole job.

After configured retries:
- mark the paragraph `FAILED`
- continue processing other paragraphs
- do not render final output automatically if failed paragraphs remain
- allow an explicit `--allow-untranslated` flag to retain original text for failed paragraphs

## 15. Testing

Unit tests:
- configuration validation
- language direction
- display ordering
- paragraph extraction
- deterministic segment IDs
- placeholder preservation
- response ID validation
- duplicate and missing translation detection
- batching by token budget
- daily and monthly accounting
- cache keys
- scheduler locking
- retry classification
- safe ZIP extraction
- XHTML reconstruction

Integration tests:
- read and rebuild a minimal EPUB without changing content
- translate a minimal French EPUB using `MockTranslationStrategy`
- translate a minimal English EPUB using `MockTranslationStrategy`
- resume a partially completed job
- stop at a token budget and set `PAUSED_BUDGET`
- continue during the next run
- generate `ENGLISH_FIRST` output
- generate `FRENCH_FIRST` output
- preserve images and internal links
- ensure `mimetype` is first and uncompressed
- validate generated EPUB structure

Fixture EPUBs:
- simple paragraphs
- nested `em`/`strong` elements
- headings
- lists
- image and caption
- internal link
- footnote
- long paragraph
- malformed archive
- path traversal archive

Do not use live paid API calls in the default test suite.

Put optional provider smoke tests behind:

```env
RUN_LIVE_LLM_TESTS=true
```

## 16. Observability

Log:
- job ID
- stage
- segment count
- batch count
- provider
- model
- input and output token usage
- retry count
- elapsed time
- budget remaining
- status transition

Do not log:
- API keys
- full EPUB content
- full paragraph text by default

At completion, create a JSON report next to the output EPUB:

```json
{
  "jobId": "...",
  "sourceFile": "...",
  "outputFile": "...",
  "sourceLanguage": "fr",
  "targetLanguage": "en",
  "displayOrder": "ENGLISH_FIRST",
  "totalSegments": 1000,
  "translatedSegments": 1000,
  "failedSegments": 0,
  "inputTokens": 120000,
  "outputTokens": 150000,
  "provider": "claude",
  "model": "...",
  "startedAt": "...",
  "completedAt": "..."
}
```

## 17. Directory structure

```text
src/
  cli/
    commands/
    index.ts

  config/
    env.ts
    schema.ts
    presets.ts

  domain/
    job.ts
    segment.ts
    translation.ts
    errors.ts

  epub/
    epub-reader.ts
    epub-writer.ts
    epub-validator.ts
    content-extractor.ts
    paragraph-segmenter.ts
    bilingual-renderer.ts
    inline-placeholder.ts
    safe-archive.ts

  translation/
    translation-strategy.ts
    translation-orchestrator.ts
    translation-validator.ts
    batch-builder.ts
    prompt.ts
    providers/
      claude-translation-strategy.ts
      mock-translation-strategy.ts

  budget/
    token-budget-manager.ts
    cost-calculator.ts

  persistence/
    database.ts
    migrations/
    job-repository.ts
    segment-repository.ts
    translation-cache.ts

  scheduler/
    scheduler-service.ts
    distributed-lock.ts

  logging/
    logger.ts

  app/
    create-job.ts
    inspect-book.ts
    run-job.ts
    render-job.ts

tests/
  unit/
  integration/
  fixtures/
```

## 18. Implementation milestones

### Milestone 1: Project foundation
- TypeScript strict configuration
- CLI shell
- Zod configuration
- logging
- tests
- SQLite initialization

### Milestone 2: EPUB round-trip
- safe extraction
- container and OPF parsing
- spine resolution
- unchanged EPUB reconstruction
- structural validation

Acceptance criterion:
A fixture EPUB can be unpacked and rebuilt without losing chapters, images, CSS, navigation, or links.

### Milestone 3: Extraction and segmentation
- translatable block extraction
- deterministic paragraph IDs
- inline placeholders
- inspection command
- token-independent dry report

Acceptance criterion:
Every supported paragraph can be listed in stable reading order.

### Milestone 4: Mock bilingual rendering
- `MockTranslationStrategy`
- paragraph pairs
- both display orders
- stylesheet injection

Acceptance criterion:
A bilingual fixture EPUB opens correctly and contains one pair for each source paragraph.

### Milestone 5: Claude strategy
- Anthropic adapter
- strict structured responses
- token-count preflight
- usage capture
- retry handling
- environment-based credentials

Acceptance criterion:
An optional smoke test translates a small set of paragraphs and validates all IDs.

### Milestone 6: Persistence and resumability
- job and segment tables
- cache
- state transitions
- resume interrupted jobs

Acceptance criterion:
Killing and restarting the process does not duplicate completed translations.

### Milestone 7: Budget-aware batching
- request/run/day/month budgets
- presets
- safety margin
- `PAUSED_BUDGET` behavior
- cost calculation configuration

Acceptance criterion:
A job stops before exceeding its configured budget and resumes later.

### Milestone 8: Scheduler
- manual, daily, weekly
- timezone setting
- locking
- missed-run behavior
- status commands

Acceptance criterion:
Only one execution can process a job at a time.

### Milestone 9: Validation and reports
- final EPUB validation
- unresolved-link detection
- processing report
- failure summary

### Milestone 10: Documentation and packaging
- README
- configuration reference
- sample commands
- troubleshooting
- npm package executable
- Docker optional, but not required for local version 1

## 19. Version 1 non-goals

Do not implement:
- PDF input
- MOBI or Kindle conversion
- DRM removal
- fixed page alignment
- sentence-level alignment
- more than English and French
- translation editing UI
- browser frontend
- cloud job queue
- multi-user accounts
- JavaScript language toggles inside EPUB
- OCR
- image translation
- audio generation
- automatic publication or distribution
- autonomous provider selection without user configuration

## 20. Definition of done

Version 1 is complete when:

1. A user can provide a valid English or French EPUB.
2. A user can explicitly select source language and output display order.
3. The application translates one paragraph into exactly one corresponding paragraph.
4. Claude and Mock providers work through the same strategy interface.
5. Adding another provider does not require changing EPUB-processing code.
6. Processing can pause and resume.
7. Manual, daily, and weekly modes work.
8. Token and optional cost budgets are enforced before requests.
9. Generated EPUBs preserve reading order and core assets.
10. Generated EPUBs pass the implemented structural validation.
11. All critical behavior has automated tests.
12. No paid provider is called by the default test suite.

Begin with Milestone 1 only.

Before writing code, briefly restate the architecture and identify any dependency whose EPUB behavior must be verified.

## Recommended initial scheduler configuration

Use manual mode by default. For automation, recommend `BALANCED_DAILY`:

```yaml
scheduleMode: DAILY
time: "02:00"
timezone: "America/Toronto"

maxSourceTokensPerRequest: 8000
maxRequestsPerRun: 10

maxInputTokensPerRun: 100000
maxOutputTokensPerRun: 140000

tokenSafetyMarginPercent: 20
requestDelayMs: 1500
```

Core rule:

```text
Schedule determines when work starts.
Token budget determines when work stops.
```
