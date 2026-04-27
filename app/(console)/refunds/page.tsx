'use client'

import { useState } from 'react'
import useSWR from 'swr'
import toast from 'react-hot-toast'
import { Receipt, Loader2 } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/format'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function RefundsPage() {
  const { data, mutate } = useSWR<{ invoices: any[] }>('/api/admin/refunds', fetcher)
  const [selected, setSelected] = useState<any | null>(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function refund() {
    if (!selected) return
    if (reason.length < 10) return toast.error('Reason min 10 chars')
    const amt = Number(amount); if (!isFinite(amt) || amt <= 0) return toast.error('Amount required')
    if (amt > Number(selected.total)) return toast.error('Cannot exceed invoice total')
    if (!confirm(`Refund ${formatINR(amt)} on invoice ${selected.invoice_number}? This calls Cashfree immediately.`)) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/refunds/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: selected.id, amount: amt, reason }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success('Refund submitted to Cashfree')
      setSelected(null); setAmount(''); setReason(''); mutate()
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Refunds</h1>
        <p className="text-sm text-[var(--color-text-muted)]">Eligible invoices in the last 90 days. Refunds are processed via Cashfree.</p>
      </div>

      <div className="imp-card overflow-hidden">
        <table className="imp-table">
          <thead><tr><th>Invoice</th><th>Org</th><th>Product</th><th>Paid</th><th className="text-right">Total</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(data?.invoices ?? []).length === 0 && <tr><td colSpan={7} className="py-8 text-center text-[var(--color-text-dim)]">No eligible invoices.</td></tr>}
            {(data?.invoices ?? []).map((i: any) => (
              <tr key={i.id}>
                <td className="font-mono text-xs">{i.invoice_number ?? i.id.slice(0, 8)}</td>
                <td>
                  <div className="font-medium">{i.organisation?.name ?? '—'}</div>
                  <div className="text-[10px] text-[var(--color-text-dim)]">{i.organisation?.billing_email}</div>
                </td>
                <td className="text-xs">{i.product}</td>
                <td className="text-xs">{formatDate(i.paid_at)}</td>
                <td className="text-right tabular-nums">{formatINR(i.total)}</td>
                <td>
                  <span className={`imp-pill ${i.status === 'paid' ? 'bg-[#0F2A1E] text-[var(--color-success)]' : 'bg-[#2A210F] text-[var(--color-warning)]'}`}>{i.status}</span>
                </td>
                <td>
                  <button
                    disabled={!i.cashfree_order_id}
                    onClick={() => { setSelected(i); setAmount(String(i.total)); setReason('') }}
                    className="imp-btn imp-btn-danger text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Receipt size={12} /> Refund
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setSelected(null)}>
          <div onClick={(e) => e.stopPropagation()} className="imp-card p-5 max-w-md w-full space-y-3">
            <h2 className="text-lg font-semibold">Refund {selected.invoice_number ?? selected.id.slice(0, 8)}</h2>
            <div className="text-xs text-[var(--color-text-muted)]">
              Org: <strong>{selected.organisation?.name}</strong> · Total: <strong>{formatINR(selected.total)}</strong>
            </div>
            <input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Refund amount" className="imp-input" />
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (min 10 chars). Audited." className="imp-input min-h-[80px]" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setSelected(null)} className="imp-btn imp-btn-ghost">Cancel</button>
              <button onClick={refund} disabled={busy} className="imp-btn imp-btn-danger">
                {busy && <Loader2 size={14} className="animate-spin" />} Submit refund
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
