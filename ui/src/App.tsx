import { useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { AuthPanel } from './components/AuthPanel'
import { UploadDropzone } from './components/UploadDropzone'
import { TranslateForm } from './components/TranslateForm'
import { OrderProgress } from './components/OrderProgress'
import { OrderList } from './components/OrderList'
import { api } from './api'
import type { UploadResult } from './types'

type View =
  | { name: 'list' }
  | { name: 'new' }
  | { name: 'configure'; upload: UploadResult }
  | { name: 'progress'; orderId: string }

/** Reads /orders/:id (and a Stripe ?checkout=success&session_id=... redirect) out of the URL once, on load. */
function useInitialOrderIdFromUrl(): string | undefined {
  const [orderId] = useState<string | undefined>(() => {
    const match = window.location.pathname.match(/^\/orders\/([^/]+)/)
    return match?.[1]
  })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('session_id')
    if (params.get('checkout') === 'success' && sessionId) {
      api.reconcileCheckout(sessionId).finally(() => {
        window.history.replaceState({}, '', window.location.pathname)
      })
    }
  }, [])

  return orderId
}

export default function App() {
  const { user, loading, logout } = useAuth()
  const initialOrderId = useInitialOrderIdFromUrl()
  const [view, setView] = useState<View>(initialOrderId ? { name: 'progress', orderId: initialOrderId } : { name: 'list' })
  const [listRefreshKey, setListRefreshKey] = useState(0)

  if (loading) return null
  if (!user) return <AuthPanel />

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">Bilingual EPUB</span>
        <span className="muted">{user.email}</span>
        <button type="button" className="link" onClick={() => void logout()}>
          Sign out
        </button>
      </header>

      <main>
        {view.name === 'list' && (
          <OrderList
            refreshKey={listRefreshKey}
            onNewTranslation={() => setView({ name: 'new' })}
            onSelect={(orderId) => setView({ name: 'progress', orderId })}
          />
        )}

        {view.name === 'new' && (
          <UploadDropzone onUploaded={(upload) => setView({ name: 'configure', upload })} />
        )}

        {view.name === 'configure' && (
          <TranslateForm
            upload={view.upload}
            onCancel={() => setView({ name: 'new' })}
            onOrderCreated={(orderId) => {
              setListRefreshKey((k) => k + 1)
              setView({ name: 'progress', orderId })
            }}
          />
        )}

        {view.name === 'progress' && (
          <OrderProgress
            orderId={view.orderId}
            onBack={() => {
              setListRefreshKey((k) => k + 1)
              setView({ name: 'list' })
            }}
          />
        )}
      </main>
    </div>
  )
}
