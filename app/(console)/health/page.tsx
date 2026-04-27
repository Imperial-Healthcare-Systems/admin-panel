'use client'

import useSWR from 'swr'
import Link from 'next/link'
import { HeartPulse, AlertTriangle, Mail } from 'lucide-react'
import { formatDate, formatNumber } from '@/lib/format'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function HealthPage() {
  const { data } = useSWR<{ rows: any[] }>('/api/admin/health', fetcher, { refreshInterval: 60_000 })

  const counts = (data?.rows ?? []).reduce((acc: Record<string, number>, r) => {
    acc[r.risk_level ?? 'unknown'] = (acc[r.risk_level ?? 'unknown'] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Customer health</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Daily snapshot, refreshed at 03:00 IST.</p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="imp-pill bg-[#0F2A1E] text-[var(--color-success)]">Healthy {counts.healthy ?? 0}</span>
          <span className="imp-pill bg-[#2A210F] text-[var(--color-warning)]">At risk {counts.at_risk ?? 0}</span>
          <span className="imp-pill bg-[#2A0E12] text-[var(--color-danger)]">Critical {counts.critical ?? 0}</span>
        </div>
      </div>

      <div className="imp-card overflow-hidden">
        <table className="imp-table">
          <thead>
            <tr>
              <th>Org</th>
              <th>Score</th>
              <th>Risk</th>
              <th>Triggers</th>
              <th>Next billing</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).length === 0 && <tr><td colSpan={6} className="py-8 text-center text-[var(--color-text-dim)]">No health snapshots yet — wait for the first cron run, or trigger /api/cron/health/snapshot manually.</td></tr>}
            {(data?.rows ?? []).map((r) => (
              <tr key={r.org_id}>
                <td>
                  <Link href={`/orgs/${r.org_id}`} className="font-medium hover:text-[var(--color-imperial-blue-light)]">{r.name}</Link>
                  <div className="text-[10px] text-[var(--color-text-dim)]">{r.billing_email ?? '—'}</div>
                </td>
                <td className="text-lg font-semibold tabular-nums">{r.health_score ?? '—'}</td>
                <td>
                  {r.risk_level === 'critical' && <span className="imp-pill bg-[#2A0E12] text-[var(--color-danger)]"><HeartPulse size={10} className="mr-1 inline" />Critical</span>}
                  {r.risk_level === 'at_risk' && <span className="imp-pill bg-[#2A210F] text-[var(--color-warning)]"><HeartPulse size={10} className="mr-1 inline" />At risk</span>}
                  {r.risk_level === 'healthy' && <span className="imp-pill bg-[#0F2A1E] text-[var(--color-success)]"><HeartPulse size={10} className="mr-1 inline" />Healthy</span>}
                  {!r.risk_level && <span className="text-[var(--color-text-dim)] text-xs">—</span>}
                </td>
                <td className="text-xs">
                  {r.triggers.length === 0 && <span className="text-[var(--color-text-dim)]">—</span>}
                  {r.triggers.map((t: string) => (
                    <span key={t} className="imp-pill bg-[var(--color-surface-3)] text-[var(--color-text-muted)] mr-1 mb-1">
                      <AlertTriangle size={10} className="mr-1 inline" />{t}
                    </span>
                  ))}
                </td>
                <td className="text-xs">{formatDate(r.next_billing_date)}</td>
                <td>
                  <a
                    href={r.billing_email ? `mailto:${r.billing_email}?subject=Quick check-in from Imperial` : undefined}
                    className="imp-btn imp-btn-ghost text-xs"
                  ><Mail size={12} /> Email CSM</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="imp-card p-4 text-xs text-[var(--color-text-muted)]">
        Score components: active users, credit balance, subscription status, ecosystem events in 30d.
        See <code className="font-mono">/api/cron/health/snapshot</code> for the calculation. Total active orgs scored: {formatNumber((data?.rows ?? []).length)}.
      </div>
    </div>
  )
}
