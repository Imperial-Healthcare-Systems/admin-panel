import { LucideIcon } from 'lucide-react'

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  icon?: LucideIcon
  tone?: 'default' | 'warn' | 'danger' | 'success'
}) {
  const toneClass =
    tone === 'warn'
      ? 'text-[var(--color-warning)]'
      : tone === 'danger'
        ? 'text-[var(--color-danger)]'
        : tone === 'success'
          ? 'text-[var(--color-success)]'
          : 'text-[var(--color-imperial-blue-light)]'

  return (
    <div className="imp-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">{label}</span>
        {Icon && <Icon size={16} className={toneClass} />}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-[var(--color-text-muted)] mt-1">{hint}</div>}
    </div>
  )
}
