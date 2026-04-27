'use client'

import { useState } from 'react'
import useSWR from 'swr'
import toast from 'react-hot-toast'
import { Plus, Save } from 'lucide-react'
import { formatNumber } from '@/lib/format'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type Feature = {
  feature_key: string
  display_name: string
  description?: string
  category?: string
  vendor_name?: string
  vendor_cost_per_unit?: number
  markup_multiplier?: number
  credits_per_unit?: number
  unit_description?: string
  default_enabled?: boolean
  is_active?: boolean
  preferred_provider?: string
}

export default function FeaturesPage() {
  const { data, mutate } = useSWR<{ features: Feature[] }>('/api/admin/features', fetcher)
  const [editing, setEditing] = useState<Feature | null>(null)
  const [bulk, setBulk] = useState({ feature_key: '', tier: 'pro', enable: true })

  async function save(f: Feature) {
    const res = await fetch('/api/admin/features', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
    })
    const json = await res.json()
    if (!res.ok) return toast.error(json.error ?? 'Failed')
    toast.success('Saved')
    setEditing(null); mutate()
  }

  async function bulkToggle() {
    if (!bulk.feature_key) return toast.error('Pick a feature')
    const res = await fetch('/api/admin/features/bulk-toggle', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature_key: bulk.feature_key, tier: bulk.tier, is_enabled: bulk.enable }),
    })
    const json = await res.json()
    if (!res.ok) return toast.error(json.error ?? 'Failed')
    toast.success(`${bulk.enable ? 'Enabled' : 'Disabled'} for ${json.applied} orgs`)
  }

  const grouped = (data?.features ?? []).reduce((acc: Record<string, Feature[]>, f) => {
    const k = f.category ?? 'uncategorised'
    ;(acc[k] = acc[k] ?? []).push(f)
    return acc
  }, {})

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Feature catalog</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Add features, set vendor cost + markup, control which tier gets what.
          </p>
        </div>
        <button onClick={() => setEditing({ feature_key: '', display_name: '', is_active: true })} className="imp-btn imp-btn-primary">
          <Plus size={14} /> New feature
        </button>
      </div>

      <div className="imp-card p-4">
        <div className="text-xs uppercase tracking-wider text-[var(--color-text-dim)] mb-3">Bulk toggle by plan tier</div>
        <div className="flex gap-2 items-center flex-wrap">
          <select value={bulk.feature_key} onChange={(e) => setBulk({ ...bulk, feature_key: e.target.value })} className="imp-input max-w-[260px]">
            <option value="">Pick feature…</option>
            {(data?.features ?? []).map((f) => <option key={f.feature_key} value={f.feature_key}>{f.display_name}</option>)}
          </select>
          <select value={bulk.tier} onChange={(e) => setBulk({ ...bulk, tier: e.target.value })} className="imp-input max-w-[140px]">
            <option value="starter">Starter</option><option value="pro">Pro</option><option value="enterprise">Enterprise</option>
          </select>
          <select value={bulk.enable ? '1' : '0'} onChange={(e) => setBulk({ ...bulk, enable: e.target.value === '1' })} className="imp-input max-w-[120px]">
            <option value="1">Enable</option><option value="0">Disable</option>
          </select>
          <button onClick={bulkToggle} className="imp-btn imp-btn-ghost">Apply</button>
        </div>
      </div>

      {Object.entries(grouped).map(([cat, feats]) => (
        <div key={cat} className="imp-card overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)] text-xs uppercase tracking-wider text-[var(--color-text-dim)]">{cat}</div>
          <table className="imp-table">
            <thead>
              <tr>
                <th>Key / display name</th>
                <th>Vendor</th>
                <th className="text-right">Cost / unit</th>
                <th className="text-right">Markup</th>
                <th className="text-right">Credits / unit</th>
                <th>Provider</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {feats.map((f) => (
                <tr key={f.feature_key}>
                  <td>
                    <div className="font-medium">{f.display_name}</div>
                    <div className="text-[10px] text-[var(--color-text-dim)] font-mono">{f.feature_key}</div>
                  </td>
                  <td className="text-xs">{f.vendor_name ?? '—'}</td>
                  <td className="text-right tabular-nums">{f.vendor_cost_per_unit ?? '—'}</td>
                  <td className="text-right tabular-nums">{f.markup_multiplier ?? '—'}×</td>
                  <td className="text-right tabular-nums font-medium">{formatNumber(f.credits_per_unit ?? 0)}</td>
                  <td className="text-xs">{f.preferred_provider ?? '—'}</td>
                  <td>{f.is_active ? <span className="imp-pill bg-[#0F2A1E] text-[var(--color-success)]">Yes</span> : <span className="imp-pill bg-[var(--color-surface-3)] text-[var(--color-text-dim)]">No</span>}</td>
                  <td><button onClick={() => setEditing(f)} className="imp-btn imp-btn-ghost text-xs">Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="imp-card p-5 max-w-lg w-full space-y-3 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold">{editing.feature_key ? 'Edit feature' : 'New feature'}</h2>
            {!editing.feature_key && (
              <input className="imp-input" placeholder="feature_key (snake_case)" value={editing.feature_key} onChange={(e) => setEditing({ ...editing, feature_key: e.target.value })} />
            )}
            <input className="imp-input" placeholder="Display name" value={editing.display_name} onChange={(e) => setEditing({ ...editing, display_name: e.target.value })} />
            <textarea className="imp-input min-h-[60px]" placeholder="Description" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className="imp-input" placeholder="Category" value={editing.category ?? ''} onChange={(e) => setEditing({ ...editing, category: e.target.value })} />
              <input className="imp-input" placeholder="Vendor" value={editing.vendor_name ?? ''} onChange={(e) => setEditing({ ...editing, vendor_name: e.target.value })} />
              <input className="imp-input" type="number" step="any" placeholder="Vendor cost / unit" value={editing.vendor_cost_per_unit ?? ''} onChange={(e) => setEditing({ ...editing, vendor_cost_per_unit: Number(e.target.value) })} />
              <input className="imp-input" type="number" step="any" placeholder="Markup multiplier" value={editing.markup_multiplier ?? ''} onChange={(e) => setEditing({ ...editing, markup_multiplier: Number(e.target.value) })} />
              <input className="imp-input col-span-2" placeholder="Unit description (e.g. 'per call')" value={editing.unit_description ?? ''} onChange={(e) => setEditing({ ...editing, unit_description: e.target.value })} />
              <select className="imp-input" value={editing.preferred_provider ?? ''} onChange={(e) => setEditing({ ...editing, preferred_provider: e.target.value })}>
                <option value="">No preferred provider</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
                <option value="azure_openai">Azure OpenAI</option>
              </select>
              <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                <input type="checkbox" checked={!!editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> Active
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                <input type="checkbox" checked={!!editing.default_enabled} onChange={(e) => setEditing({ ...editing, default_enabled: e.target.checked })} /> Default ON for new orgs
              </label>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditing(null)} className="imp-btn imp-btn-ghost">Cancel</button>
              <button onClick={() => save(editing)} className="imp-btn imp-btn-primary"><Save size={14} /> Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
