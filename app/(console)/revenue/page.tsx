'use client'

import useSWR from 'swr'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download } from 'lucide-react'
import { KpiCard } from '@/components/ui/KpiCard'
import { formatINR, formatPercent } from '@/lib/format'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type Revenue = {
  totalMRR: number; totalARR: number; activeCount: number; trialCount: number; churned30d: number
  mrrByProduct: Record<string, number>; mrrByTier: Record<string, number>
  churnRate: number; avgMrr: number; ltv: number | null
  cohorts: { month: string; cohort: number; retained: number }[]
  gst: { month: { tax: number; total: number }; quarter: { tax: number; total: number }; year: { tax: number; total: number } }
}

export default function RevenuePage() {
  const { data } = useSWR<Revenue>('/api/admin/revenue', fetcher, { refreshInterval: 60_000 })
  if (!data) return <div className="text-sm text-[var(--color-text-muted)]">Loading…</div>

  const productData = Object.entries(data.mrrByProduct).map(([k, v]) => ({ name: k, mrr: v }))
  const tierData = Object.entries(data.mrrByTier).map(([k, v]) => ({ name: k, mrr: v }))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Revenue</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="MRR" value={formatINR(data.totalMRR, { compact: true })} />
        <KpiCard label="ARR" value={formatINR(data.totalARR, { compact: true })} />
        <KpiCard label="Avg MRR / customer" value={formatINR(data.avgMrr)} />
        <KpiCard label="LTV (avg)" value={data.ltv == null ? '—' : formatINR(data.ltv, { compact: true })} hint="MRR / churn rate" />
        <KpiCard label="Churn rate (30d)" value={formatPercent(data.churnRate)} tone="warn" />
        <KpiCard label="Net new (cust.)" value={String(data.activeCount - data.churned30d)} />
        <KpiCard label="Trial pipeline" value={String(data.trialCount)} />
        <KpiCard label="Churned 30d" value={String(data.churned30d)} tone="danger" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="imp-card p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">MRR by product</h2>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={productData}>
                <CartesianGrid stroke="#1F3A5C" strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke="#6B82A0" tick={{ fontSize: 11 }} />
                <YAxis stroke="#6B82A0" tick={{ fontSize: 11 }} tickFormatter={(v) => formatINR(v, { compact: true })} />
                <Tooltip contentStyle={{ background: '#0F1E33', border: '1px solid #1F3A5C', borderRadius: 8 }} formatter={(v: number) => formatINR(v)} />
                <Bar dataKey="mrr" fill="#1E88E5" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="imp-card p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">MRR by tier</h2>
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={tierData}>
                <CartesianGrid stroke="#1F3A5C" strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke="#6B82A0" tick={{ fontSize: 11 }} />
                <YAxis stroke="#6B82A0" tick={{ fontSize: 11 }} tickFormatter={(v) => formatINR(v, { compact: true })} />
                <Tooltip contentStyle={{ background: '#0F1E33', border: '1px solid #1F3A5C', borderRadius: 8 }} formatter={(v: number) => formatINR(v)} />
                <Bar dataKey="mrr" fill="#F47920" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="imp-card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)] text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Cohort retention</div>
        <table className="imp-table">
          <thead><tr><th>Signup month</th><th className="text-right">Cohort size</th><th className="text-right">Still active</th><th className="text-right">Retention</th></tr></thead>
          <tbody>
            {data.cohorts.map((c) => (
              <tr key={c.month}>
                <td>{c.month}</td>
                <td className="text-right tabular-nums">{c.cohort}</td>
                <td className="text-right tabular-nums">{c.retained}</td>
                <td className="text-right tabular-nums">{c.cohort > 0 ? formatPercent(c.retained / c.cohort) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="imp-card p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">GST collected</div>
            <div className="grid grid-cols-3 gap-6 mt-2 text-sm">
              <div><div className="text-[var(--color-text-dim)] text-xs">This month</div><div className="font-semibold tabular-nums">{formatINR(data.gst.month.tax)}</div></div>
              <div><div className="text-[var(--color-text-dim)] text-xs">This quarter</div><div className="font-semibold tabular-nums">{formatINR(data.gst.quarter.tax)}</div></div>
              <div><div className="text-[var(--color-text-dim)] text-xs">YTD</div><div className="font-semibold tabular-nums">{formatINR(data.gst.year.tax)}</div></div>
            </div>
          </div>
          <div className="flex gap-2">
            <a href="/api/admin/revenue/gst-export?range=month" className="imp-btn imp-btn-ghost text-xs"><Download size={14}/> Month</a>
            <a href="/api/admin/revenue/gst-export?range=quarter" className="imp-btn imp-btn-ghost text-xs"><Download size={14}/> Quarter</a>
            <a href="/api/admin/revenue/gst-export?range=year" className="imp-btn imp-btn-ghost text-xs"><Download size={14}/> Year</a>
          </div>
        </div>
      </div>
    </div>
  )
}
