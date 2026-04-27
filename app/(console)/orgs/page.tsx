'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { Search, Filter } from 'lucide-react'
import { formatINR, formatDate, formatNumber } from '@/lib/format'

type Row = {
  id: string
  name: string
  slug: string
  status: string
  sub_status: string
  tier: string
  seats: number
  mrr: number
  health_score: number | null
  risk_level: string | null
  next_billing_date: string | null
  credit_balance: number
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function OrgsListPage() {
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [tierFilter, setTierFilter] = useState('')
  const [healthFilter, setHealthFilter] = useState('')

  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (statusFilter) params.set('status', statusFilter)
  if (tierFilter) params.set('tier', tierFilter)

  const { data } = useSWR<{ rows: Row[] }>(`/api/admin/orgs?${params.toString()}`, fetcher)

  const rows = useMemo(() => {
    if (!data?.rows) return []
    return healthFilter ? data.rows.filter((r) => r.risk_level === healthFilter) : data.rows
  }, [data, healthFilter])

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Organisations</h1>
          <p className="text-sm text-[var(--color-text-muted)]">All customers across IHRMS + ICRM.</p>
        </div>
      </div>

      <div className="imp-card p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-dim)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…" className="imp-input pl-9 py-1.5" />
        </div>
        <Filter size={14} className="text-[var(--color-text-dim)]" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="imp-input py-1.5 max-w-[160px]">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} className="imp-input py-1.5 max-w-[160px]">
          <option value="">All tiers</option>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)} className="imp-input py-1.5 max-w-[160px]">
          <option value="">All health</option>
          <option value="healthy">Healthy</option>
          <option value="at_risk">At risk</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      <div className="imp-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="imp-table">
            <thead>
              <tr>
                <th>Organisation</th>
                <th>Tier</th>
                <th>Seats</th>
                <th className="text-right">MRR</th>
                <th>Status</th>
                <th>Health</th>
                <th>Next billing</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!data && (
                <tr><td colSpan={8} className="text-center text-[var(--color-text-dim)] py-8">Loading…</td></tr>
              )}
              {data && rows.length === 0 && (
                <tr><td colSpan={8} className="text-center text-[var(--color-text-dim)] py-8">No organisations match the filters.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/orgs/${r.id}`} className="font-medium hover:text-[var(--color-imperial-blue-light)]">
                      {r.name}
                    </Link>
                    <div className="text-[10px] text-[var(--color-text-dim)] font-mono">{r.slug}</div>
                  </td>
                  <td className="capitalize">{r.tier || '—'}</td>
                  <td>{formatNumber(r.seats)}</td>
                  <td className="text-right tabular-nums font-medium">{formatINR(r.mrr)}</td>
                  <td>
                    <StatusPill status={r.sub_status} />
                  </td>
                  <td>
                    <HealthPill score={r.health_score} risk={r.risk_level} />
                  </td>
                  <td>{formatDate(r.next_billing_date)}</td>
                  <td>
                    <Link href={`/orgs/${r.id}`} className="imp-btn imp-btn-ghost py-1 px-2 text-xs">Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-[#0F2A1E] text-[var(--color-success)]',
    trial: 'bg-[#2A210F] text-[var(--color-warning)]',
    past_due: 'bg-[#2A0E12] text-[var(--color-danger)]',
    suspended: 'bg-[#2A0E12] text-[var(--color-danger)]',
    cancelled: 'bg-[var(--color-surface-3)] text-[var(--color-text-dim)]',
  }
  return <span className={`imp-pill ${map[status] ?? 'bg-[var(--color-surface-3)] text-[var(--color-text-muted)]'}`}>{status}</span>
}

function HealthPill({ score, risk }: { score: number | null; risk: string | null }) {
  if (score == null) return <span className="text-[var(--color-text-dim)] text-xs">—</span>
  const color =
    risk === 'critical' ? 'var(--color-danger)' : risk === 'at_risk' ? 'var(--color-warning)' : 'var(--color-success)'
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="font-medium tabular-nums">{score}</span>
      <span className="text-[10px] text-[var(--color-text-dim)] uppercase">{risk}</span>
    </span>
  )
}
