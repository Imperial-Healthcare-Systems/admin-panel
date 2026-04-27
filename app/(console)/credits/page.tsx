'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Coins, Loader2 } from 'lucide-react'
import { formatNumber } from '@/lib/format'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function CreditsPage() {
  const { data } = useSWR<{ totalOutstanding: number; topConsumers: any[]; byFeature: any[] }>('/api/admin/credits', fetcher)
  const [grant, setGrant] = useState({ amount: '', reason: '', tier: '', product: '', status: '' })
  const [busy, setBusy] = useState(false)

  async function bulk() {
    if (!grant.amount || Number(grant.amount) <= 0) return toast.error('Amount required')
    if (grant.reason.length < 10) return toast.error('Reason min 10 chars')
    setBusy(true)
    try {
      const res = await fetch('/api/admin/credits/bulk-grant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(grant.amount),
          reason: grant.reason,
          filter: {
            tier: grant.tier || undefined,
            product: grant.product || undefined,
            status: grant.status || undefined,
          },
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success(`Granted to ${json.applied} orgs`)
      setGrant({ amount: '', reason: '', tier: '', product: '', status: '' })
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Credits</h1>

      <div className="imp-card p-6">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Outstanding liability</div>
        <div className="flex items-baseline gap-3 mt-1">
          <Coins size={24} className="text-[var(--color-saffron)]" />
          <div className="text-4xl font-semibold tabular-nums">{formatNumber(data?.totalOutstanding ?? 0)}</div>
          <div className="text-xs text-[var(--color-text-dim)]">credits across all orgs</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="imp-card overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)] text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Top consumers (this month)</div>
          <table className="imp-table">
            <thead><tr><th>Org</th><th className="text-right">Consumed</th></tr></thead>
            <tbody>
              {(data?.topConsumers ?? []).length === 0 && <tr><td colSpan={2} className="py-6 text-center text-[var(--color-text-dim)]">No consumption yet.</td></tr>}
              {(data?.topConsumers ?? []).map((c) => (
                <tr key={c.org_id}>
                  <td><Link href={`/orgs/${c.org_id}`} className="hover:text-[var(--color-imperial-blue-light)]">{c.name}</Link></td>
                  <td className="text-right tabular-nums">{formatNumber(c.consumed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="imp-card overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)] text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Feature usage breakdown (this month)</div>
          <table className="imp-table">
            <thead><tr><th>Reference</th><th className="text-right">Credits</th></tr></thead>
            <tbody>
              {(data?.byFeature ?? []).length === 0 && <tr><td colSpan={2} className="py-6 text-center text-[var(--color-text-dim)]">No data.</td></tr>}
              {(data?.byFeature ?? []).map((f) => (
                <tr key={f.reference_type}>
                  <td className="font-mono text-xs">{f.reference_type}</td>
                  <td className="text-right tabular-nums">{formatNumber(f.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="imp-card p-4 space-y-3">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Bulk promotional grant</div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <input type="number" placeholder="Amount" value={grant.amount} onChange={(e) => setGrant({ ...grant, amount: e.target.value })} className="imp-input" />
          <select value={grant.tier} onChange={(e) => setGrant({ ...grant, tier: e.target.value })} className="imp-input">
            <option value="">Any tier</option>
            <option value="starter">Starter</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option>
          </select>
          <select value={grant.product} onChange={(e) => setGrant({ ...grant, product: e.target.value })} className="imp-input">
            <option value="">Any product</option>
            <option value="ihrms">IHRMS</option><option value="icrm">ICRM</option><option value="bundle">Bundle</option>
          </select>
          <select value={grant.status} onChange={(e) => setGrant({ ...grant, status: e.target.value })} className="imp-input">
            <option value="">Any status</option>
            <option value="active">Active</option><option value="trial">Trial</option>
          </select>
          <input placeholder="Reason (min 10)" value={grant.reason} onChange={(e) => setGrant({ ...grant, reason: e.target.value })} className="imp-input" />
        </div>
        <button onClick={bulk} disabled={busy} className="imp-btn imp-btn-primary">
          {busy && <Loader2 size={14} className="animate-spin" />} Grant
        </button>
      </div>
    </div>
  )
}
