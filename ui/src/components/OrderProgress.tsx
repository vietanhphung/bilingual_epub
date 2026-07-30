import { useEffect, useState } from 'react'
import { api } from '../api'
import type { OrderSummary } from '../types'

interface Props {
  orderId: string
  onBack: () => void
}

const TERMINAL_JOB_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED'])

export function OrderProgress({ orderId, onBack }: Props) {
  const [order, setOrder] = useState<OrderSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      try {
        const { order } = await api.getOrder(orderId)
        if (cancelled) return
        setOrder(order)
        const jobDone = order.job && TERMINAL_JOB_STATUSES.has(order.job.status)
        const orderStuck = order.status === 'PAYMENT_FAILED' || order.status === 'CANCELLED'
        if (!jobDone && !orderStuck) {
          timer = setTimeout(poll, 2000)
        }
      } catch {
        if (!cancelled) setError('Lost connection while checking progress.')
      }
    }
    void poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [orderId])

  if (error) return <p className="error">{error}</p>
  if (!order) return <p>Loading…</p>

  const job = order.job
  const pct = job && job.totalSegments > 0 ? Math.round(((job.completedSegments + job.failedSegments) / job.totalSegments) * 100) : 0

  return (
    <div className="card">
      <h2>Translation progress</h2>

      {!job && order.status === 'AWAITING_PAYMENT' && (
        <p>Waiting for payment confirmation… this updates automatically once Stripe confirms your payment.</p>
      )}

      {job && (
        <>
          <p className="status-line">
            Status: <strong>{describeStatus(job.status)}</strong>
          </p>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="muted">
            {job.completedSegments + job.failedSegments} / {job.totalSegments} paragraphs processed
            {job.failedSegments > 0 && ` (${job.failedSegments} failed)`}
          </p>
          <p className="muted">
            {job.accumulatedInputTokens.toLocaleString()} in / {job.accumulatedOutputTokens.toLocaleString()} out tokens used
          </p>

          {job.status === 'COMPLETED' && (
            <a className="primary button-link" href={api.downloadUrl(order.id)}>
              Download bilingual EPUB
            </a>
          )}
          {job.status === 'FAILED' && <p className="error">{job.errorMessage ?? 'Translation failed.'}</p>}
        </>
      )}

      <button type="button" className="link" onClick={onBack}>
        Back to my translations
      </button>
    </div>
  )
}

function describeStatus(status: string): string {
  switch (status) {
    case 'PAUSED_BUDGET':
      return 'Paused (budget) — will resume shortly'
    case 'PAUSED_RATE_LIMIT':
      return 'Paused (rate limit) — will resume shortly'
    case 'TRANSLATING':
      return 'Translating'
    case 'RENDERING':
      return 'Building your EPUB'
    case 'VALIDATING':
      return 'Validating output'
    default:
      return status.charAt(0) + status.slice(1).toLowerCase()
  }
}
