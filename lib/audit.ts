import { supabaseAdmin } from '@/lib/supabase'

export type AuditEntry = {
  admin_id: string
  action: string
  target_type?: string | null
  target_id?: string | null
  payload?: Record<string, unknown> | null
  ip_address?: string | null
}

/**
 * Write a row to platform_admin_log. Every admin mutation MUST call this
 * (Section 8 + Section 10 handover prompt). Never throws — audit failure
 * should never block a user-visible action, but it is logged to console
 * so we can spot drop-outs.
 */
export async function audit(entry: AuditEntry) {
  try {
    const { error } = await supabaseAdmin.from('platform_admin_log').insert({
      admin_id: entry.admin_id,
      action: entry.action,
      target_type: entry.target_type ?? null,
      target_id: entry.target_id ?? null,
      payload: entry.payload ?? null,
      ip_address: entry.ip_address ?? null,
    })
    if (error) console.error('[audit] insert failed:', error.message)
  } catch (err) {
    console.error('[audit] threw:', err)
  }
}

export function ipFromRequest(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const real = req.headers.get('x-real-ip')
  return real ?? null
}
