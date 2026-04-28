'use client'

import { useState } from 'react'
import { Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'

type Check = { name: string; ok: boolean; ms: number; error?: string; sample?: unknown }
type Report = {
  summary: { total: number; passed: number; failed: number; ok: boolean }
  checks: Check[]
  generated_at: string
  admin: string
}

export default function QAPage() {
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function run() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/admin/qa/smoke-test')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'failed')
      setReport(json)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">QA smoke test</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Read-only sanity check across every spec route. Mutations are excluded — see UAT checklist for those.
          </p>
        </div>
        <button onClick={run} disabled={busy} className="imp-btn imp-btn-primary">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Run smoke test
        </button>
      </div>

      {err && <div className="imp-card p-4 text-[var(--color-danger)] text-sm">{err}</div>}

      {report && (
        <>
          <div className="imp-card p-4 flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Summary</div>
              <div className="text-2xl font-semibold mt-1">
                {report.summary.passed} / {report.summary.total} passed
                {report.summary.failed > 0 && (
                  <span className="text-[var(--color-danger)] text-base ml-3">{report.summary.failed} failed</span>
                )}
              </div>
            </div>
            <div className={`imp-pill ${report.summary.ok ? 'bg-[#0F2A1E] text-[var(--color-success)]' : 'bg-[#2A0E12] text-[var(--color-danger)]'}`}>
              {report.summary.ok ? 'GREEN' : 'RED'}
            </div>
          </div>

          <div className="imp-card overflow-hidden">
            <table className="imp-table">
              <thead><tr><th></th><th>Check</th><th className="text-right">ms</th><th>Error</th></tr></thead>
              <tbody>
                {report.checks.map((c, i) => (
                  <tr key={i}>
                    <td>
                      {c.ok
                        ? <CheckCircle2 size={16} className="text-[var(--color-success)]" />
                        : <XCircle size={16} className="text-[var(--color-danger)]" />}
                    </td>
                    <td className="font-mono text-xs">{c.name}</td>
                    <td className="text-right tabular-nums text-xs">{c.ms}</td>
                    <td className="text-xs text-[var(--color-danger)] break-all">{c.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="imp-card p-4 text-xs">
            <summary className="cursor-pointer text-[var(--color-text-muted)]">Raw report</summary>
            <pre className="mt-2 text-[10px] text-[var(--color-text-dim)] overflow-x-auto">
{JSON.stringify(report, null, 2)}
            </pre>
          </details>
        </>
      )}

      {!report && !busy && !err && (
        <div className="imp-card p-8 text-center text-[var(--color-text-dim)] text-sm">
          Click <strong>Run smoke test</strong> to verify schema + every spec route in one shot.
        </div>
      )}
    </div>
  )
}
