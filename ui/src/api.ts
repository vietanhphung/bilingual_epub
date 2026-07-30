import type { AuthUser, OrderSummary, UploadResult } from './types'

export class ApiError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...init,
  })
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(body.message ?? res.statusText, body.error ?? 'UNKNOWN', res.status)
  }
  return body as T
}

export const api = {
  signup: (email: string, password: string) =>
    request<{ user: AuthUser }>('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<{ user: AuthUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: AuthUser }>('/auth/me'),

  uploadFile: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<UploadResult>('/uploads', { method: 'POST', body: form })
  },
  uploadFromDriveLink: (url: string) =>
    request<UploadResult>('/uploads/from-drive-link', { method: 'POST', body: JSON.stringify({ url }) }),

  createOrder: (input: {
    uploadId: string
    sourceLanguage: 'en' | 'fr'
    targetLanguage: 'en' | 'fr'
    displayOrder: 'ENGLISH_FIRST' | 'FRENCH_FIRST'
  }) =>
    request<{ order: OrderSummary; checkoutUrl: string | null }>('/translations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listOrders: () => request<{ orders: OrderSummary[] }>('/translations'),
  getOrder: (id: string) => request<{ order: OrderSummary }>(`/translations/${id}`),
  downloadUrl: (id: string) => `/api/translations/${id}/download`,

  reconcileCheckout: (sessionId: string) =>
    request<{ ok: true }>(`/billing/reconcile/${sessionId}`, { method: 'POST' }),
}
