'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Download, ScrollText, ShieldAlert } from 'lucide-react'
import { formatDateTime } from '@/lib/format'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function AuditPage() {
  const [adminFilter, setAdminFilter] = useState('')
  const [action, setAction] = useState('')
  const [org, setOrg] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')

  const params = new URLSearchParams()
  if (adminFilter) params.set('admin', adminFilter)
  if (action) params.set('action', action)
  if (org) params.set('org', org)
  if (since) params.set('since', new Date(since).toISOString())
  if (until) params.set('until', new Date(until).toISOString())

  const { data } = useSWR<{ entries: any[] }>(`/api/admin/audit?${params.toString()}`, fetcher)

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><ScrollText size={20} /> Audit log</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Every admin mutation + impersonation, in chronological order.</p>
        </div>
        <a
          href={`/api/admin/audit/export?${params.toString()}`}
          className="imp-btn imp-btn-ghost"
        ><Download size={14} /> Export CSV</a>
      </div>

      <div className="imp-card p-3 grid grid-cols-2 md:grid-cols-5 gap-2">
        <input value={adminFilter} onChange={(e) => setAdminFilter(e.target.value)} placeholder="Admin id" className="imp-input" />
        <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Action (e.g. credits.adjust)" className="imp-input" />
        <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Target org id" className="imp-input" />
        <input type="date" value={since} onChange={(e) => setSince(e.target.value)} className="imp-input" />
        <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="imp-input" />
      </div>

      <div className="imp-card overflow-hidden">
        <table className="imp-table">
          <thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Target</th><th>IP</th><th>Payload</th></tr></thead>
          <tbody>
            {(data?.entries ?? []).length === 0 && <tr><td colSpan={6} className="py-8 text-center text-[var(--color-text-dim)]">No matching entries.</td></tr>}
            {(data?.entries ?? []).map((e) => (
              <tr key={`${e.kind}-${e.id}`}>
                <td className="text-xs whitespace-nowrap">{formatDateTime(e.ts)}</td>
                <td>
                  <div className="text-sm">{e.admin_name}</div>
                  <div className="text-[10px] text-[var(--color-text-dim)] font-mono">{e.admin_id.slice(0, 8)}</div>
                </td>
                <td>
                  {e.kind === 'impersonation' ? (
                    <span className="imp-pill bg-[#2A0E12] text-[var(--color-danger)]"><ShieldAlert size={10} className="mr-1 inline" />{e.action}</span>
                  ) : (
                    <span className="font-mono text-xs text-[var(--color-imperial-blue-light)]">{e.action}</span>
                  )}
                </td>
                <td className="text-xs">
                  <div>{e.target_type ?? '—'}</div>
                  {e.target_id && <div className="text-[10px] text-[var(--color-text-dim)] font-mono">{String(e.target_id).slice(0, 8)}</div>}
                </td>
                <td className="text-[10px] text-[var(--color-text-dim)] font-mono">{e.ip_address ?? '—'}</td>
                <td>
                  <details className="text-[10px]">
                    <summary className="cursor-pointer text-[var(--color-text-muted)]">view</summary>
                    <pre className="mt-1 max-w-md overflow-x-auto text-[10px] text-[var(--color-text-dim)] bg-[var(--color-surface-2)] p-2 rounded">{JSON.stringify(e.payload, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
