export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidEpubError extends AppError {
  constructor(message: string) {
    super(message, "INVALID_EPUB");
  }
}

export class UnsupportedLanguageError extends AppError {
  constructor(message: string) {
    super(message, "UNSUPPORTED_LANGUAGE");
  }
}

export class UnsupportedGranularityError extends AppError {
  constructor(message: string) {
    super(message, "UNSUPPORTED_GRANULARITY");
  }
}

export class UnsafeArchiveError extends AppError {
  constructor(message: string) {
    super(message, "UNSAFE_ARCHIVE");
  }
}

export class ManifestResolutionError extends AppError {
  constructor(message: string) {
    super(message, "MANIFEST_RESOLUTION");
  }
}

export class TranslationProviderError extends AppError {
  constructor(
    message: string,
    public readonly retryable: boolean = false,
  ) {
    super(message, "TRANSLATION_PROVIDER");
  }
}

export class TranslationValidationError extends AppError {
  constructor(message: string) {
    super(message, "TRANSLATION_VALIDATION");
  }
}

export class TokenBudgetExceededError extends AppError {
  constructor(message: string) {
    super(message, "TOKEN_BUDGET_EXCEEDED");
  }
}

export class RateLimitError extends AppError {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message, "RATE_LIMIT");
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string) {
    super(message, "AUTHENTICATION");
  }
}

export class OutputValidationError extends AppError {
  constructor(message: string) {
    super(message, "OUTPUT_VALIDATION");
  }
}
