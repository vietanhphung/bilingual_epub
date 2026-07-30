import { useState } from 'react'
import { api, ApiError } from '../api'
import type { UploadResult } from '../types'

interface Props {
  upload: UploadResult
  onOrderCreated: (orderId: string) => void
  onCancel: () => void
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function TranslateForm({ upload, onOrderCreated, onCancel }: Props) {
  const [sourceLanguage, setSourceLanguage] = useState<'en' | 'fr'>('fr')
  const [targetLanguage, setTargetLanguage] = useState<'en' | 'fr'>('en')
  const [displayOrder, setDisplayOrder] = useState<'ENGLISH_FIRST' | 'FRENCH_FIRST'>('ENGLISH_FIRST')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function flipLanguages() {
    setSourceLanguage(targetLanguage)
    setTargetLanguage(sourceLanguage)
  }

  async function handleSubmit() {
    setError(null)
    setBusy(true)
    try {
      const { order, checkoutUrl } = await api.createOrder({
        uploadId: upload.upload.id,
        sourceLanguage,
        targetLanguage,
        displayOrder,
      })
      if (checkoutUrl) {
        window.location.href = checkoutUrl
        return
      }
      onOrderCreated(order.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start translation.')
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2>{upload.upload.originalFilename}</h2>
      <dl className="stats">
        <div>
          <dt>Chapters</dt>
          <dd>{upload.upload.chapterCount}</dd>
        </div>
        <div>
          <dt>Paragraphs</dt>
          <dd>{upload.upload.paragraphCount}</dd>
        </div>
        <div>
          <dt>Estimated tokens</dt>
          <dd>
            {upload.upload.sourceTokenEstimate.toLocaleString()} in / {upload.upload.estimatedOutputTokens.toLocaleString()} out
          </dd>
        </div>
      </dl>

      <div className="language-row">
        <label>
          Source language
          <select value={sourceLanguage} onChange={(e) => setSourceLanguage(e.target.value as 'en' | 'fr')}>
            <option value="en">English</option>
            <option value="fr">French</option>
          </select>
        </label>
        <button type="button" className="link swap" onClick={flipLanguages} aria-label="Swap languages">
          ⇄
        </button>
        <label>
          Target language
          <select value={targetLanguage} onChange={(e) => setTargetLanguage(e.target.value as 'en' | 'fr')}>
            <option value="en">English</option>
            <option value="fr">French</option>
          </select>
        </label>
      </div>

      <label>
        Display order in the output
        <select value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value as typeof displayOrder)}>
          <option value="ENGLISH_FIRST">English first</option>
          <option value="FRENCH_FIRST">French first</option>
        </select>
      </label>

      <div className="price-box">
        {upload.eligibleForFree ? (
          <p className="price free">Free — your one free translation</p>
        ) : upload.pricingUnavailable ? (
          <p className="price unavailable">
            Pricing isn't configured on this server yet — the operator needs to set
            MODEL_INPUT/OUTPUT_PRICE_PER_MILLION_TOKENS_USD before paid translations can run.
          </p>
        ) : (
          <p className="price">{formatUsd(upload.amountUsdCents ?? 0)} for this translation</p>
        )}
      </div>

      {sourceLanguage === targetLanguage && <p className="error">Source and target languages must differ.</p>}
      {error && <p className="error">{error}</p>}

      <div className="actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
          Back
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || sourceLanguage === targetLanguage || upload.pricingUnavailable}
          onClick={handleSubmit}
        >
          {busy ? 'Starting…' : upload.eligibleForFree ? 'Translate for free' : 'Pay and translate'}
        </button>
      </div>
    </div>
  )
}
