'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { Search, Filter, Plus, X, Loader2 } from 'lucide-react'
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

  const { data, mutate } = useSWR<{ rows: Row[] }>(`/api/admin/orgs?${params.toString()}`, fetcher)

  const rows = useMemo(() => {
    if (!data?.rows) return []
    return healthFilter ? data.rows.filter((r) => r.risk_level === healthFilter) : data.rows
  }, [data, healthFilter])

  const [showCreate, setShowCreate] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Organisations</h1>
          <p className="text-sm text-[var(--color-text-muted)]">All customers across IHRMS + ICRM.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="imp-btn imp-btn-primary flex items-center gap-1.5">
          <Plus size={14} /> New Organisation
        </button>
      </div>

      {showCreate && <CreateOrgModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); mutate() }} />}

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
          <option value="archived">Archived</option>
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

/* ───────────── Create Organisation Modal ───────────── */
function CreateOrgModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '', billing_email: '', contact_phone: '', gstin: '',
    enable_icrm: true, enable_hrms: true,
    tier: 'starter', seats: 1, amount: 0, trial_days: 14,
    starter_credits: 100,
  })
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  const upd = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!form.name.trim()) { setErr('Name is required.'); return }

    const subscriptions: Array<{ product: 'icrm' | 'ihrms' | 'bundle'; tier: string; seats: number; amount_per_month: number; status: 'trial'; trial_days: number }> = []
    if (form.enable_icrm && form.enable_hrms) {
      subscriptions.push({ product: 'bundle', tier: form.tier, seats: form.seats, amount_per_month: form.amount, status: 'trial', trial_days: form.trial_days })
    } else if (form.enable_icrm) {
      subscriptions.push({ product: 'icrm', tier: form.tier, seats: form.seats, amount_per_month: form.amount, status: 'trial', trial_days: form.trial_days })
    } else if (form.enable_hrms) {
      subscriptions.push({ product: 'ihrms', tier: form.tier, seats: form.seats, amount_per_month: form.amount, status: 'trial', trial_days: form.trial_days })
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          billing_email: form.billing_email.trim() || null,
          contact_phone: form.contact_phone.trim() || null,
          gstin: form.gstin.trim() || null,
          subscriptions,
          starter_credits: form.starter_credits,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? 'Failed to create organisation.'); return }
      onCreated()
    } catch {
      setErr('Network error.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit}
        className="imp-card w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold">New Organisation</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Provision a new tenant on the Imperial platform.</p>
          </div>
          <button type="button" onClick={onClose} className="text-[var(--color-text-dim)] hover:text-white"><X size={18} /></button>
        </div>

        {err && <div className="mb-4 px-3 py-2 rounded bg-[#2A0E12] text-[var(--color-danger)] text-sm">{err}</div>}

        <div className="space-y-4">
          {/* Identity */}
          <Section title="Identity">
            <Field label="Organisation name *">
              <input className="imp-input" value={form.name} onChange={(e) => upd('name', e.target.value)} placeholder="Acme Healthcare Pvt Ltd" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Billing email">
                <input type="email" className="imp-input" value={form.billing_email} onChange={(e) => upd('billing_email', e.target.value)} placeholder="billing@acme.com" />
              </Field>
              <Field label="Contact phone">
                <input className="imp-input" value={form.contact_phone} onChange={(e) => upd('contact_phone', e.target.value)} placeholder="+91 ..." />
              </Field>
            </div>
            <Field label="GSTIN">
              <input className="imp-input" value={form.gstin} onChange={(e) => upd('gstin', e.target.value)} placeholder="06AAACI0000A1Z5" />
            </Field>
          </Section>

          {/* Products */}
          <Section title="Products & Subscription">
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.enable_icrm} onChange={(e) => upd('enable_icrm', e.target.checked)} />
                <span className="text-sm">ICRM</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.enable_hrms} onChange={(e) => upd('enable_hrms', e.target.checked)} />
                <span className="text-sm">IHRMS</span>
              </label>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Tier">
                <select className="imp-input" value={form.tier} onChange={(e) => upd('tier', e.target.value)}>
                  <option value="starter">Starter</option>
                  <option value="growth">Growth</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </Field>
              <Field label="Seats">
                <input type="number" min={1} className="imp-input" value={form.seats} onChange={(e) => upd('seats', Number(e.target.value) || 1)} />
              </Field>
              <Field label="Monthly ₹">
                <input type="number" min={0} className="imp-input" value={form.amount} onChange={(e) => upd('amount', Number(e.target.value) || 0)} />
              </Field>
              <Field label="Trial days">
                <input type="number" min={0} className="imp-input" value={form.trial_days} onChange={(e) => upd('trial_days', Number(e.target.value) || 0)} />
              </Field>
            </div>
          </Section>

          {/* Credits */}
          <Section title="Initial Credits">
            <Field label="Starter credit balance">
              <input type="number" min={0} className="imp-input" value={form.starter_credits} onChange={(e) => upd('starter_credits', Number(e.target.value) || 0)} />
            </Field>
          </Section>
        </div>

        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-[var(--color-border)]">
          <button type="button" onClick={onClose} className="imp-btn imp-btn-ghost">Cancel</button>
          <button type="submit" disabled={submitting} className="imp-btn imp-btn-primary flex items-center gap-1.5">
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {submitting ? 'Creating…' : 'Create Organisation'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-dim)] mb-2">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-[var(--color-text-muted)] mb-1">{label}</label>
      {children}
    </div>
  )
}
