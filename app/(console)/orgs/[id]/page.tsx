'use client'

import { useState, useEffect, use } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ArrowLeft, AlertTriangle, Coins, Sparkles, Users, ScrollText, ShieldAlert,
  Receipt, Loader2, ToggleLeft, ToggleRight, ExternalLink,
  type LucideIcon,
} from 'lucide-react'
import { formatINR, formatNumber, formatDate, formatDateTime, relativeTime } from '@/lib/format'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type Tab = 'overview' | 'subscription' | 'credits' | 'features' | 'users' | 'activity' | 'impersonate'

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: AlertTriangle },
  { id: 'subscription', label: 'Subscription', icon: Receipt },
  { id: 'credits', label: 'Credits', icon: Coins },
  { id: 'features', label: 'Features', icon: Sparkles },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'activity', label: 'Activity', icon: ScrollText },
  { id: 'impersonate', label: 'Impersonate', icon: ShieldAlert },
]

export default function OrgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: orgId } = use(params)
  const [tab, setTab] = useState<Tab>('overview')
  const { data: core } = useSWR<{ org: any; stats: any; health: any }>(
    `/api/admin/orgs/${orgId}`,
    fetcher,
  )

  if (!core) return <div className="text-sm text-[var(--color-text-muted)]">Loading…</div>

  const { org, stats, health } = core
  const sub = (org.subscriptions ?? [])[0]
  const credits = (org.credits ?? [])[0]
  const override = (org.plan_override ?? [])[0]
  const mrr = (org.subscriptions ?? [])
    .filter((s: any) => s.status === 'active' || s.status === 'past_due')
    .reduce((acc: number, s: any) => acc + Number(s.amount_per_month ?? 0), 0)

  return (
    <div className="space-y-4">
      <Link href="/orgs" className="inline-flex items-center gap-1 text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-muted)]">
        <ArrowLeft size={12} /> Back to organisations
      </Link>

      {/* Header */}
      <div className="imp-card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{org.name}</h1>
              <span className="imp-pill bg-[var(--color-surface-3)] text-[var(--color-text-muted)]">{org.status}</span>
              {health && (
                <span
                  className="imp-pill"
                  style={{
                    background: health.risk_level === 'critical' ? '#2A0E12' : health.risk_level === 'at_risk' ? '#2A210F' : '#0F2A1E',
                    color: health.risk_level === 'critical' ? 'var(--color-danger)' : health.risk_level === 'at_risk' ? 'var(--color-warning)' : 'var(--color-success)',
                  }}
                >
                  Health {health.health_score} · {health.risk_level}
                </span>
              )}
            </div>
            <div className="text-xs text-[var(--color-text-dim)] font-mono mt-1">{org.slug}</div>
            <div className="text-sm text-[var(--color-text-muted)] mt-2">{org.billing_email ?? 'No billing email on file'}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-[var(--color-text-dim)] uppercase tracking-wider">MRR</div>
            <div className="text-2xl font-semibold tabular-nums">{formatINR(mrr)}</div>
            <div className="text-xs text-[var(--color-text-muted)] mt-1">Signed up {formatDate(org.signup_at)}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[var(--color-border)] flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm transition-colors border-b-2 ${
                active
                  ? 'border-[var(--color-imperial-blue-light)] text-[var(--color-text)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              <Icon size={14} /> {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {tab === 'overview' && <OverviewTab orgId={orgId} stats={stats} credits={credits} sub={sub} health={health} />}
      {tab === 'subscription' && <SubscriptionTab orgId={orgId} subs={org.subscriptions ?? []} override={override} />}
      {tab === 'credits' && <CreditsTab orgId={orgId} />}
      {tab === 'features' && <FeaturesTab orgId={orgId} />}
      {tab === 'users' && <UsersTab orgId={orgId} />}
      {tab === 'activity' && <ActivityTab orgId={orgId} />}
      {tab === 'impersonate' && <ImpersonateTab orgId={orgId} />}
    </div>
  )
}

// ---------- Overview ----------
function OverviewTab({ orgId, stats, credits, sub, health }: any) {
  void orgId
  const alerts: { tone: 'warn' | 'danger' | 'info'; msg: string }[] = []
  if (sub?.status === 'past_due') alerts.push({ tone: 'danger', msg: 'Subscription is past due — payment failed.' })
  if (sub?.status === 'trial' && sub.trial_ends_at) {
    const days = Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86_400_000)
    if (days <= 7) alerts.push({ tone: 'warn', msg: `Trial ends in ${days} day(s).` })
  }
  if (Number(credits?.balance ?? 0) < 100) alerts.push({ tone: 'warn', msg: 'Credit balance is low.' })
  if (health?.risk_level === 'critical') alerts.push({ tone: 'danger', msg: 'Customer health is CRITICAL — risk of churn.' })
  if (stats.activeUsers === 0) alerts.push({ tone: 'warn', msg: 'No active users.' })

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="imp-card p-4">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-2">Total users</div>
        <div className="text-2xl font-semibold">{formatNumber(stats.totalUsers)}</div>
      </div>
      <div className="imp-card p-4">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-2">Active (30d)</div>
        <div className="text-2xl font-semibold">{formatNumber(stats.activeUsers)}</div>
      </div>
      <div className="imp-card p-4">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-2">Credit balance</div>
        <div className="text-2xl font-semibold tabular-nums">{formatNumber(credits?.balance ?? 0)}</div>
      </div>
      <div className="imp-card p-4">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-2">Next billing</div>
        <div className="text-base font-semibold">{formatDate(sub?.next_billing_date)}</div>
      </div>

      <div className="imp-card p-4 lg:col-span-3">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-3">Alerts</div>
        {alerts.length === 0 && <div className="text-sm text-[var(--color-text-muted)]">All systems normal.</div>}
        <ul className="space-y-2">
          {alerts.map((a, i) => (
            <li
              key={i}
              className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg"
              style={{
                background: a.tone === 'danger' ? '#2A0E12' : a.tone === 'warn' ? '#2A210F' : 'var(--color-surface-2)',
                color: a.tone === 'danger' ? 'var(--color-danger)' : a.tone === 'warn' ? 'var(--color-warning)' : 'var(--color-text)',
              }}
            >
              <AlertTriangle size={14} /> {a.msg}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ---------- Subscription ----------
function SubscriptionTab({ orgId, subs, override }: any) {
  const [busy, setBusy] = useState(false)
  async function patch(body: any) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/subscription`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success('Updated')
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      {subs.length === 0 && <div className="imp-card p-6 text-center text-[var(--color-text-muted)]">No subscriptions.</div>}
      {subs.map((s: any) => (
        <div key={s.id} className="imp-card p-4">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">{s.product}</div>
              <div className="text-lg font-semibold mt-1">
                {s.tier} · {s.seats} seats · {formatINR(s.amount_per_month)} / month
              </div>
              <div className="text-xs text-[var(--color-text-muted)] mt-1">
                {s.status} · Period: {formatDate(s.current_period_start)} – {formatDate(s.current_period_end)}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {s.status !== 'active' && (
                <button disabled={busy} onClick={() => patch({ subscription_id: s.id, action: 'reactivate' })} className="imp-btn imp-btn-ghost text-xs">Reactivate</button>
              )}
              {s.status === 'active' && (
                <>
                  <button disabled={busy} onClick={() => {
                    const tier = prompt('New tier?', s.tier); if (!tier) return
                    const seats = Number(prompt('Seats?', String(s.seats)) ?? s.seats)
                    const amt = Number(prompt('Amount/month?', String(s.amount_per_month)) ?? s.amount_per_month)
                    patch({ subscription_id: s.id, action: 'upgrade', tier, seats, amount_per_month: amt })
                  }} className="imp-btn imp-btn-ghost text-xs">Upgrade / Edit</button>
                  <button disabled={busy} onClick={() => {
                    const reason = prompt('Reason for suspending? (min 10 chars)'); if (!reason || reason.length < 10) return
                    patch({ subscription_id: s.id, action: 'suspend', reason })
                  }} className="imp-btn imp-btn-danger text-xs">Suspend</button>
                  <button disabled={busy} onClick={() => {
                    const reason = prompt('Reason for cancelling? (min 10 chars)'); if (!reason || reason.length < 10) return
                    if (!confirm(`Cancel ${s.product} subscription? This is destructive.`)) return
                    patch({ subscription_id: s.id, action: 'cancel', reason })
                  }} className="imp-btn imp-btn-danger text-xs">Cancel</button>
                </>
              )}
            </div>
          </div>
        </div>
      ))}

      <div className="imp-card p-4">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-3">Plan override (grandfathered pricing)</div>
        {override ? (
          <div className="text-sm">
            <div>Custom amount: <strong>{formatINR(override.custom_amount_per_month)}</strong> / month</div>
            <div className="text-[var(--color-text-muted)] mt-1">Reason: {override.reason}</div>
            <div className="text-xs text-[var(--color-text-dim)] mt-1">
              Effective {formatDate(override.effective_from)}{override.expires_on ? ` → ${formatDate(override.expires_on)}` : ' · no expiry'}
            </div>
          </div>
        ) : (
          <button disabled={busy} onClick={() => {
            const sub = subs[0]; if (!sub) return toast.error('No subscription to override')
            const amt = Number(prompt('Custom amount/month (INR)?')); if (!amt) return
            const reason = prompt('Reason for override? (min 10 chars)'); if (!reason || reason.length < 10) return
            const effective = prompt('Effective from (YYYY-MM-DD)?', new Date().toISOString().slice(0, 10))
            if (!effective) return
            patch({ subscription_id: sub.id, action: 'override', amount_per_month: amt, reason, effective_from: effective })
          }} className="imp-btn imp-btn-ghost text-sm">Set override</button>
        )}
      </div>
    </div>
  )
}

// ---------- Credits ----------
function CreditsTab({ orgId }: { orgId: string }) {
  const { data, mutate } = useSWR<{ wallet: any; transactions: any[] }>(`/api/admin/orgs/${orgId}/credits`, fetcher)
  const [amount, setAmount] = useState('')
  const [type, setType] = useState<'promotional' | 'adjustment' | 'refund'>('promotional')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function adjust(e: React.FormEvent) {
    e.preventDefault()
    if (reason.length < 10) return toast.error('Reason min 10 chars')
    const amt = Number(amount); if (!isFinite(amt) || amt === 0) return toast.error('Amount required')
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/credits/adjust`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, type, reason }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success(`New balance: ${json.newBalance}`)
      setAmount(''); setReason('')
      mutate()
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="imp-card p-5 md:col-span-1">
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Current balance</div>
          <div className="text-4xl font-semibold tabular-nums mt-1">{formatNumber(data?.wallet?.balance ?? 0)}</div>
          <div className="text-[10px] text-[var(--color-text-dim)] mt-2">credits</div>
        </div>
        <div className="imp-card p-5">
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Lifetime purchased</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{formatNumber(data?.wallet?.lifetime_purchased ?? 0)}</div>
        </div>
        <div className="imp-card p-5">
          <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Lifetime consumed</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{formatNumber(data?.wallet?.lifetime_consumed ?? 0)}</div>
        </div>
      </div>

      <form onSubmit={adjust} className="imp-card p-4 space-y-3">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Manual adjust</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (+ / –)" className="imp-input" />
          <select value={type} onChange={(e) => setType(e.target.value as any)} className="imp-input">
            <option value="promotional">Promotional</option>
            <option value="adjustment">Adjustment</option>
            <option value="refund">Refund</option>
          </select>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (min 10 chars)" className="imp-input" />
        </div>
        <button type="submit" disabled={busy} className="imp-btn imp-btn-primary">
          {busy && <Loader2 size={14} className="animate-spin" />} Apply adjustment
        </button>
      </form>

      <div className="imp-card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)] text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Transactions (last 100)</div>
        <table className="imp-table">
          <thead><tr><th>When</th><th>Type</th><th className="text-right">Amount</th><th className="text-right">Balance after</th><th>Notes</th></tr></thead>
          <tbody>
            {(data?.transactions ?? []).map((t) => (
              <tr key={t.id}>
                <td className="text-xs">{formatDateTime(t.created_at)}</td>
                <td><span className="imp-pill bg-[var(--color-surface-3)]">{t.type}</span></td>
                <td className={`text-right tabular-nums ${Number(t.amount) >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
                  {Number(t.amount) >= 0 ? '+' : ''}{formatNumber(t.amount)}
                </td>
                <td className="text-right tabular-nums">{formatNumber(t.balance_after)}</td>
                <td className="text-xs text-[var(--color-text-muted)]">{t.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------- Features ----------
function FeaturesTab({ orgId }: { orgId: string }) {
  const { data, mutate } = useSWR<{ features: any[] }>(`/api/admin/orgs/${orgId}/features`, fetcher)

  async function toggle(feature_key: string, is_enabled: boolean) {
    const res = await fetch(`/api/admin/orgs/${orgId}/features`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature_key, is_enabled }),
    })
    const json = await res.json()
    if (!res.ok) return toast.error(json.error ?? 'Failed')
    toast.success(is_enabled ? 'Enabled' : 'Disabled')
    mutate()
  }

  const grouped = (data?.features ?? []).reduce((acc: Record<string, any[]>, f) => {
    const key = f.category ?? 'uncategorised'
    ;(acc[key] = acc[key] ?? []).push(f)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([cat, feats]) => (
        <div key={cat} className="imp-card overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)] text-xs uppercase tracking-wider text-[var(--color-text-dim)]">
            {cat}
          </div>
          <table className="imp-table">
            <thead><tr><th>Feature</th><th>Vendor</th><th className="text-right">Credits / unit</th><th>Notes</th><th></th></tr></thead>
            <tbody>
              {feats.map((f) => (
                <tr key={f.feature_key}>
                  <td>
                    <div className="font-medium">{f.display_name}</div>
                    <div className="text-[10px] text-[var(--color-text-dim)] font-mono">{f.feature_key}</div>
                  </td>
                  <td className="text-xs text-[var(--color-text-muted)]">{f.vendor_name ?? '—'}</td>
                  <td className="text-right tabular-nums">{f.custom_credits_per_unit ?? f.credits_per_unit ?? '—'}</td>
                  <td className="text-xs text-[var(--color-text-muted)]">{f.notes ?? '—'}</td>
                  <td>
                    <button
                      onClick={() => toggle(f.feature_key, !f.is_enabled)}
                      className="inline-flex items-center"
                      title={f.is_enabled ? 'Disable' : 'Enable'}
                    >
                      {f.is_enabled
                        ? <ToggleRight size={28} className="text-[var(--color-success)]" />
                        : <ToggleLeft size={28} className="text-[var(--color-text-dim)]" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

// ---------- Users ----------
function UsersTab({ orgId }: { orgId: string }) {
  const { data } = useSWR<{ employees: any[]; crmUsers: any[] }>(`/api/admin/orgs/${orgId}/users`, fetcher)
  const all = [
    ...((data?.employees ?? []).map((e) => ({ ...e, _product: 'ihrms' }))),
    ...((data?.crmUsers ?? []).map((u) => ({ ...u, _product: 'icrm' }))),
  ]
  return (
    <div className="imp-card overflow-hidden">
      <table className="imp-table">
        <thead><tr><th>Name</th><th>Email</th><th>Product</th><th>Role</th><th>Status</th><th>Last login</th></tr></thead>
        <tbody>
          {all.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-[var(--color-text-dim)]">No users</td></tr>}
          {all.map((u) => (
            <tr key={`${u._product}-${u.id}`}>
              <td>{u.full_name ?? '—'}</td>
              <td className="text-xs">{u.email}</td>
              <td className="text-xs uppercase">{u._product}</td>
              <td className="text-xs text-[var(--color-text-muted)]">{u.role}</td>
              <td>{u.status === 'active' ? <span className="imp-pill bg-[#0F2A1E] text-[var(--color-success)]">Active</span> : <span className="imp-pill bg-[var(--color-surface-3)] text-[var(--color-text-dim)]">{u.status ?? 'inactive'}</span>}</td>
              <td className="text-xs">{u.last_login_at ? relativeTime(u.last_login_at) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- Activity ----------
function ActivityTab({ orgId }: { orgId: string }) {
  const [source, setSource] = useState('')
  const params = new URLSearchParams()
  if (source) params.set('source', source)
  const { data } = useSWR<{ events: any[] }>(`/api/admin/orgs/${orgId}/activity?${params.toString()}`, fetcher)
  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <select value={source} onChange={(e) => setSource(e.target.value)} className="imp-input py-1.5 max-w-[200px]">
          <option value="">All sources</option>
          <option value="ihrms">IHRMS</option>
          <option value="icrm">ICRM</option>
          <option value="admin">Admin</option>
          <option value="system">System</option>
        </select>
      </div>
      <div className="imp-card overflow-hidden">
        <table className="imp-table">
          <thead><tr><th>When</th><th>Source</th><th>Event</th><th>Actor</th><th>Payload</th></tr></thead>
          <tbody>
            {(data?.events ?? []).length === 0 && <tr><td colSpan={5} className="py-6 text-center text-[var(--color-text-dim)]">No events</td></tr>}
            {(data?.events ?? []).map((e) => (
              <tr key={e.id}>
                <td className="text-xs">{relativeTime(e.created_at)}</td>
                <td><span className="imp-pill bg-[var(--color-surface-3)]">{e.source_platform}</span></td>
                <td className="font-mono text-xs">{e.event_type}</td>
                <td className="text-xs text-[var(--color-text-muted)]">{e.actor_type ?? '—'}</td>
                <td><code className="text-[10px] text-[var(--color-text-dim)]">{JSON.stringify(e.payload)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------- Impersonate ----------
function ImpersonateTab({ orgId }: { orgId: string }) {
  const { data } = useSWR<{ employees: any[]; crmUsers: any[] }>(`/api/admin/orgs/${orgId}/users`, fetcher)
  const [product, setProduct] = useState<'ihrms' | 'icrm'>('ihrms')
  const [userId, setUserId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const users = product === 'ihrms' ? (data?.employees ?? []) : (data?.crmUsers ?? [])

  // Track impersonation session for end-call on tab close.
  useEffect(() => {
    function onBeforeUnload() {
      const logId = sessionStorage.getItem('imp_log_id')
      if (logId) {
        navigator.sendBeacon(
          `/api/admin/orgs/${orgId}/impersonate/end`,
          new Blob([JSON.stringify({ logId, actionsTaken: [] })], { type: 'application/json' }),
        )
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [orgId])

  async function start() {
    if (reason.trim().length < 20) return toast.error('Reason min 20 chars')
    if (!userId) return toast.error('Pick a user')
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/impersonate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, product, reason }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      sessionStorage.setItem('imp_log_id', json.logId)
      window.open(json.targetUrl, '_blank', 'noopener')
      toast.success('Impersonation session started — opens in a new tab.')
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="imp-impersonation-banner rounded-lg">
        ⚠ All actions taken under impersonation are logged with your admin id, the customer id, and your stated reason. Use sparingly.
      </div>
      <div className="imp-card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <select value={product} onChange={(e) => { setProduct(e.target.value as any); setUserId('') }} className="imp-input">
            <option value="ihrms">IHRMS</option>
            <option value="icrm">ICRM</option>
          </select>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className="imp-input">
            <option value="">Pick a user…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name ?? u.email} — {u.email}</option>)}
          </select>
        </div>
        <textarea
          value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for impersonation (min 20 chars). Logged forever."
          className="imp-input min-h-[80px]"
        />
        <button disabled={busy} onClick={start} className="imp-btn imp-btn-danger">
          {busy && <Loader2 size={14} className="animate-spin" />}
          <ExternalLink size={14} /> Impersonate
        </button>
      </div>
    </div>
  )
}
