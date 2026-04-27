'use client'

import { useState } from 'react'
import useSWR from 'swr'
import toast from 'react-hot-toast'
import { Cloud, Loader2, Download } from 'lucide-react'
import { KpiCard } from '@/components/ui/KpiCard'
import { formatINR, formatPercent, formatDate } from '@/lib/format'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const VENDORS = ['openai', 'gemini', 'cashfree', 'whatsapp_bsp', 'supabase', 'vercel', 'resend', 'upstash']

export default function VendorsPage() {
  const { data, mutate } = useSWR<any>('/api/admin/vendors', fetcher)
  const [form, setForm] = useState({ vendor: 'openai', period_month: new Date().toISOString().slice(0, 7) + '-01', amount_usd: '', amount_inr: '', units_consumed: '', notes: '' })
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    try {
      const res = await fetch('/api/admin/vendors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor: form.vendor, period_month: form.period_month,
          amount_usd: form.amount_usd ? Number(form.amount_usd) : null,
          amount_inr: form.amount_inr ? Number(form.amount_inr) : null,
          units_consumed: form.units_consumed ? Number(form.units_consumed) : null,
          notes: form.notes || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success('Saved'); mutate()
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  async function pullOpenAI() {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/vendors/openai-pull', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success(`Pulled $${json.amount_usd.toFixed(2)} for this month`); mutate()
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Vendor cost</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Spend (this month)" value={formatINR(data?.monthSpend ?? 0, { compact: true })} icon={Cloud} />
        <KpiCard label="Active customers" value={String(data?.activeCount ?? 0)} />
        <KpiCard label="Cost / customer" value={formatINR(data?.costPerCustomer ?? 0)} />
        <KpiCard label="Gross margin" value={formatPercent(data?.grossMargin ?? 0)} tone={data?.grossMargin > 0.6 ? 'success' : 'warn'} />
      </div>

      <div className="imp-card p-4">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Add / update vendor cost</div>
          <button disabled={busy} onClick={pullOpenAI} className="imp-btn imp-btn-ghost text-xs">
            <Download size={14} /> Pull OpenAI usage (this month)
          </button>
        </div>
        <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-6 gap-2">
          <select value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} className="imp-input">
            {VENDORS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <input type="date" value={form.period_month} onChange={(e) => setForm({ ...form, period_month: e.target.value })} className="imp-input" />
          <input type="number" step="any" placeholder="USD" value={form.amount_usd} onChange={(e) => setForm({ ...form, amount_usd: e.target.value })} className="imp-input" />
          <input type="number" step="any" placeholder="INR" value={form.amount_inr} onChange={(e) => setForm({ ...form, amount_inr: e.target.value })} className="imp-input" />
          <input type="number" step="any" placeholder="Units" value={form.units_consumed} onChange={(e) => setForm({ ...form, units_consumed: e.target.value })} className="imp-input" />
          <button type="submit" disabled={busy} className="imp-btn imp-btn-primary">
            {busy && <Loader2 size={14} className="animate-spin" />} Save
          </button>
          <input placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="imp-input md:col-span-6" />
        </form>
      </div>

      <div className="imp-card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)] text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Last 6 months</div>
        <table className="imp-table">
          <thead><tr><th>Vendor</th><th>Month</th><th className="text-right">USD</th><th className="text-right">INR</th><th className="text-right">Units</th><th>Notes</th></tr></thead>
          <tbody>
            {(data?.rows ?? []).length === 0 && <tr><td colSpan={6} className="py-6 text-center text-[var(--color-text-dim)]">No data yet.</td></tr>}
            {(data?.rows ?? []).map((r: any) => (
              <tr key={r.id}>
                <td className="font-medium">{r.vendor}</td>
                <td className="text-xs">{formatDate(r.period_month)}</td>
                <td className="text-right tabular-nums">{r.amount_usd != null ? `$${Number(r.amount_usd).toFixed(2)}` : '—'}</td>
                <td className="text-right tabular-nums">{r.amount_inr != null ? formatINR(r.amount_inr) : '—'}</td>
                <td className="text-right tabular-nums">{r.units_consumed ?? '—'}</td>
                <td className="text-xs text-[var(--color-text-muted)]">{r.notes ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
