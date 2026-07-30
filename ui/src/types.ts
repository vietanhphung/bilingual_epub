export interface AuthUser {
  id: string
  email: string
  freeTranslationAvailable: boolean
}

export interface UploadResult {
  upload: {
    id: string
    originalFilename: string
    chapterCount: number
    paragraphCount: number
    sourceTokenEstimate: number
    estimatedOutputTokens: number
  }
  eligibleForFree: boolean
  amountUsdCents: number | null
  pricingUnavailable: boolean
}

export type JobStatus =
  | 'CREATED'
  | 'EXTRACTING'
  | 'SEGMENTING'
  | 'READY'
  | 'TRANSLATING'
  | 'PAUSED_BUDGET'
  | 'PAUSED_RATE_LIMIT'
  | 'RENDERING'
  | 'VALIDATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'

export interface JobSummary {
  id: string
  status: JobStatus
  totalSegments: number
  completedSegments: number
  failedSegments: number
  accumulatedInputTokens: number
  accumulatedOutputTokens: number
  errorMessage: string | null
}

export type OrderStatus = 'FREE_GRANTED' | 'AWAITING_PAYMENT' | 'PAID' | 'PAYMENT_FAILED' | 'CANCELLED'

export interface OrderSummary {
  id: string
  status: OrderStatus
  isFree: boolean
  amountUsdCents: number
  sourceLanguage: 'en' | 'fr'
  targetLanguage: 'en' | 'fr'
  displayOrder: 'ENGLISH_FIRST' | 'FRENCH_FIRST'
  estimatedInputTokens: number
  estimatedOutputTokens: number
  errorMessage: string | null
  createdAt: string
  job: JobSummary | null
}
