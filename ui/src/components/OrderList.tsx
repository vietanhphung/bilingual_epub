import { useEffect, useState } from 'react'
import { api } from '../api'
import type { OrderSummary } from '../types'

interface Props {
  onSelect: (orderId: string) => void
  onNewTranslation: () => void
  refreshKey: number
}

export function OrderList({ onSelect, onNewTranslation, refreshKey }: Props) {
  const [orders, setOrders] = useState<OrderSummary[] | null>(null)

  useEffect(() => {
    api.listOrders().then(({ orders }) => setOrders(orders))
  }, [refreshKey])

  return (
    <div className="card">
      <div className="row-between">
        <h2>My translations</h2>
        <button type="button" className="primary" onClick={onNewTranslation}>
          New translation
        </button>
      </div>

      {orders === null && <p>Loading…</p>}
      {orders?.length === 0 && <p className="muted">No translations yet — start your first one above.</p>}

      <ul className="order-list">
        {orders?.map((order) => (
          <li key={order.id}>
            <button type="button" className="order-row" onClick={() => onSelect(order.id)}>
              <span>
                {order.sourceLanguage} → {order.targetLanguage}
              </span>
              <span className="muted">{order.job ? order.job.status : order.status}</span>
              <span className="muted">{order.isFree ? 'Free' : `$${(order.amountUsdCents / 100).toFixed(2)}`}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
