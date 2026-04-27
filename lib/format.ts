// INR formatting + small display helpers used across the console.

export function formatINR(amount: number | string | null | undefined, opts: { compact?: boolean } = {}) {
  const n = Number(amount ?? 0)
  if (!isFinite(n)) return '₹0'
  if (opts.compact) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 1,
      notation: 'compact',
    }).format(n)
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
}

export function formatNumber(n: number | string | null | undefined, opts: { compact?: boolean } = {}) {
  const num = Number(n ?? 0)
  if (!isFinite(num)) return '0'
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 1,
    notation: opts.compact ? 'compact' : 'standard',
  }).format(num)
}

export function formatPercent(n: number, fractionDigits = 1) {
  if (!isFinite(n)) return '0%'
  return `${(n * 100).toFixed(fractionDigits)}%`
}

export function formatDate(d: string | Date | null | undefined) {
  if (!d) return '—'
  try {
    const date = typeof d === 'string' ? new Date(d) : d
    return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(date)
  } catch {
    return '—'
  }
}

export function formatDateTime(d: string | Date | null | undefined) {
  if (!d) return '—'
  try {
    const date = typeof d === 'string' ? new Date(d) : d
    return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
  } catch {
    return '—'
  }
}

export function relativeTime(d: string | Date | null | undefined) {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  const seconds = (Date.now() - date.getTime()) / 1000
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`
  return formatDate(date)
}
