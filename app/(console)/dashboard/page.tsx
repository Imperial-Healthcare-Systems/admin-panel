'use client'

import useSWR from 'swr'
import { useEffect } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Building2, TrendingUp, AlertTriangle, FlaskConical, Coins, Cloud } from 'lucide-react'
import { KpiCard } from '@/components/ui/KpiCard'
import { formatINR, formatNumber, relativeTime } from '@/lib/format'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type Dashboard = {
  kpis: {
    totalMRR: number
    totalARR: number
    activeCount: number
    trialCount: number
    atRiskCount: number
    vendorSpendMonth: number
  }
  mrrTrend: { month: string; mrr: number }[]
  dailySignups: { day: string; count: number }[]
  creditsConsumed: number
  recentEvents: { id: string; admin_id: string; action: string; target_type: string | null; created_at: string }[]
}

export default function DashboardPage() {
  const { data, error, mutate } = useSWR<Dashboard>('/api/admin/dashboard', fetcher, {
    refreshInterval: 60_000,
  })

  // Fail loud on error so the operator notices.
  useEffect(() => {
    if (error) console.error('[dashboard]', error)
  }, [error])

  if (!data) {
    return <div className="text-[var(--color-text-muted)] text-sm">Loading platform metrics…</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Platform Dashboard</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Live state across IHRMS + ICRM customers.</p>
        </div>
        <button onClick={() => mutate()} className="imp-btn imp-btn-ghost">Refresh</button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard label="Total MRR" value={formatINR(data.kpis.totalMRR, { compact: true })} icon={TrendingUp} tone="success" />
        <KpiCard label="Total ARR" value={formatINR(data.kpis.totalARR, { compact: true })} icon={TrendingUp} />
        <KpiCard label="Active" value={String(data.kpis.activeCount)} icon={Building2} hint="Paying customers" />
        <KpiCard label="Trial" value={String(data.kpis.trialCount)} icon={FlaskConical} tone="warn" />
        <KpiCard label="At risk" value={String(data.kpis.atRiskCount)} icon={AlertTriangle} tone="danger" hint="Health critical/at-risk" />
        <KpiCard label="Vendor (mo.)" value={formatINR(data.kpis.vendorSpendMonth, { compact: true })} icon={Cloud} hint="OpenAI + Cashfree + …" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="imp-card p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">MRR (last 12 months)</h2>
            <span className="text-xs text-[var(--color-text-dim)]">INR</span>
          </div>
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <AreaChart data={data.mrrTrend}>
                <defs>
                  <linearGradient id="mrr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1E88E5" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#1E88E5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1F3A5C" strokeDasharray="3 3" />
                <XAxis dataKey="month" stroke="#6B82A0" tick={{ fontSize: 11 }} />
                <YAxis stroke="#6B82A0" tick={{ fontSize: 11 }} tickFormatter={(v) => formatINR(v, { compact: true })} />
                <Tooltip contentStyle={{ background: '#0F1E33', border: '1px solid #1F3A5C', borderRadius: 8 }} formatter={(v: number) => formatINR(v)} />
                <Area type="monotone" dataKey="mrr" stroke="#1E88E5" strokeWidth={2} fill="url(#mrr)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="imp-card p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">Signups this month</h2>
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={data.dailySignups}>
                <CartesianGrid stroke="#1F3A5C" strokeDasharray="3 3" />
                <XAxis dataKey="day" stroke="#6B82A0" tick={{ fontSize: 10 }} hide />
                <YAxis stroke="#6B82A0" tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: '#0F1E33', border: '1px solid #1F3A5C', borderRadius: 8 }} />
                <Bar dataKey="count" fill="#F47920" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Credits + Events */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="imp-card p-6 flex flex-col justify-center">
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-2 flex items-center gap-2">
            <Coins size={14} /> Credits consumed (this month)
          </div>
          <div className="text-3xl font-semibold">{formatNumber(data.creditsConsumed, { compact: true })}</div>
          <div className="text-xs text-[var(--color-text-muted)] mt-1">Aggregate across all orgs</div>
        </div>

        <div className="imp-card p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">Recent admin events</h2>
          <ul className="divide-y divide-[var(--color-border)]">
            {data.recentEvents.length === 0 && (
              <li className="text-sm text-[var(--color-text-dim)] py-3">No events yet.</li>
            )}
            {data.recentEvents.map((e) => (
              <li key={e.id} className="py-2 flex justify-between text-sm">
                <span>
                  <span className="font-mono text-xs text-[var(--color-imperial-blue-light)]">{e.action}</span>
                  <span className="text-[var(--color-text-dim)]"> · {e.target_type ?? '—'}</span>
                </span>
                <span className="text-xs text-[var(--color-text-dim)]">{relativeTime(e.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
