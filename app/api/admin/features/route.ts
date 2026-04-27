// §5.3 — Feature catalog admin (CRUD + bulk-toggle).
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'
import { ipFromRequest } from '@/lib/audit'

export async function GET() {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin
  const { data, error } = await supabaseAdmin
    .from('feature_catalog')
    .select('feature_key,display_name,description,category,vendor_name,vendor_cost_per_unit,markup_multiplier,credits_per_unit,unit_description,default_enabled,is_active,preferred_provider')
    .order('category', { ascending: true })
    .order('display_name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ features: data ?? [] })
}

const upsertSchema = z.object({
  feature_key: z.string().min(2),
  display_name: z.string().min(2),
  description: z.string().optional(),
  category: z.string().optional(),
  vendor_name: z.string().optional(),
  vendor_cost_per_unit: z.number().optional(),
  markup_multiplier: z.number().optional(),
  unit_description: z.string().optional(),
  default_enabled: z.boolean().optional(),
  is_active: z.boolean().optional(),
  preferred_provider: z.string().optional(),
})

export async function POST(req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  const body = await req.json().catch(() => null)
  const parsed = upsertSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const row: Record<string, unknown> = { ...parsed.data }
  // Auto-compute credits_per_unit if cost + markup provided (§5.3).
  if (parsed.data.vendor_cost_per_unit != null && parsed.data.markup_multiplier != null) {
    row.credits_per_unit = parsed.data.vendor_cost_per_unit * parsed.data.markup_multiplier
  }

  const { error } = await supabaseAdmin
    .from('feature_catalog')
    .upsert(row, { onConflict: 'feature_key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('platform_admin_log').insert({
    admin_id: admin.adminId,
    action: 'feature.catalog.upsert',
    target_type: 'feature_catalog',
    target_id: null,
    payload: row,
    ip_address: ipFromRequest(req),
  })

  return NextResponse.json({ success: true })
}
