'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import toast from 'react-hot-toast'
import { Plus, RotateCcw, ShieldCheck } from 'lucide-react'
import { formatDateTime } from '@/lib/format'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function SettingsPage() {
  const { data: session } = useSession()
  const { data, mutate } = useSWR<{ admins: any[] }>('/api/admin/settings/admins', fetcher)
  const [newEmail, setNewEmail] = useState('')
  const [busy, setBusy] = useState(false)

  async function grant(grantOn: boolean, email: string) {
    if (!email) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/settings/admins', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, is_platform_admin: grantOn }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success(grantOn ? 'Granted' : 'Revoked')
      setNewEmail(''); mutate()
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  async function resetTotp(employeeId: string, isSelf: boolean) {
    if (!confirm(isSelf ? 'Reset YOUR TOTP? You will be re-enrolled at next login.' : 'Reset this admin\'s TOTP? They will be re-enrolled at next login.')) return
    const res = await fetch('/api/admin/settings/reset-totp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: employeeId }),
    })
    const json = await res.json()
    if (!res.ok) return toast.error(json.error ?? 'Failed')
    toast.success('TOTP reset'); mutate()
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><ShieldCheck size={20} /> Settings</h1>
        <p className="text-sm text-[var(--color-text-muted)]">Platform admin management. All actions audited.</p>
      </div>

      <div className="imp-card p-4">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-2">Your session</div>
        <div className="text-sm">
          <strong>{session?.user?.name}</strong>
          <span className="text-[var(--color-text-dim)]"> · {session?.user?.email}</span>
        </div>
        <div className="text-xs text-[var(--color-text-muted)] mt-1">
          Sessions expire after 8 hours. TOTP required at every login.
        </div>
      </div>

      <div className="imp-card p-4 space-y-3">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Grant platform admin</div>
        <div className="flex gap-2 flex-wrap">
          <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="employee@imperialhealthcare.cloud" className="imp-input flex-1 min-w-[260px]" />
          <button onClick={() => grant(true, newEmail)} disabled={busy} className="imp-btn imp-btn-primary"><Plus size={14} /> Grant</button>
        </div>
        <p className="text-xs text-[var(--color-text-dim)]">Only super_admin or operations_head roles can grant or revoke. The target must already exist in <code>employees</code> with the Imperial org slug.</p>
      </div>

      <div className="imp-card overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-border)] text-xs uppercase tracking-wider text-[var(--color-text-dim)]">Current admins</div>
        <table className="imp-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>TOTP</th><th>Last login</th><th></th></tr></thead>
          <tbody>
            {(data?.admins ?? []).length === 0 && <tr><td colSpan={6} className="py-6 text-center text-[var(--color-text-dim)]">No admins yet.</td></tr>}
            {(data?.admins ?? []).map((a) => {
              const isSelf = a.id === (session?.user as { id?: string })?.id
              return (
                <tr key={a.id}>
                  <td>{a.full_name ?? a.email} {isSelf && <span className="text-[10px] text-[var(--color-text-dim)]">(you)</span>}</td>
                  <td className="text-xs">{a.email}</td>
                  <td className="text-xs">{a.role}</td>
                  <td>
                    {a.totp_enabled
                      ? <span className="imp-pill bg-[#0F2A1E] text-[var(--color-success)]">Enrolled</span>
                      : <span className="imp-pill bg-[#2A210F] text-[var(--color-warning)]">Not enrolled</span>}
                  </td>
                  <td className="text-xs">{a.last_login_at ? formatDateTime(a.last_login_at) : '—'}</td>
                  <td className="text-right space-x-1">
                    <button onClick={() => resetTotp(a.id, isSelf)} className="imp-btn imp-btn-ghost text-xs"><RotateCcw size={12} /> Reset TOTP</button>
                    {!isSelf && <button onClick={() => grant(false, a.email)} className="imp-btn imp-btn-danger text-xs">Revoke</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
