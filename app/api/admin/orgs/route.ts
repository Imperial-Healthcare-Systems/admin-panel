// §5.2 list view feed.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/session'
import { audit } from '@/lib/audit'
import { sendOrgWelcomeEmail } from '@/lib/email'

const PRODUCT_LABEL: Record<string, string> = { ihrms: 'IHRMS', icrm: 'ICRM', bundle: 'IHRMS + ICRM' }

export async function GET(req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }
  void admin

  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.toLowerCase().trim() ?? ''
  const status = url.searchParams.get('status') ?? ''
  const tier = url.searchParams.get('tier') ?? ''

  let query = supabaseAdmin
    .from('organisations')
    .select(`
      id,name,slug,billing_email,status,signup_at,
      subscriptions:org_subscriptions(product,tier,status,seats,amount_per_month,next_billing_date),
      credits:org_credits(balance)
    `)
    .order('signup_at', { ascending: false })
    .limit(500)

  if (q) query = query.ilike('name', `%${q}%`)
  if (status) query = query.eq('status', status)

  const { data: orgs, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Pull most-recent health snapshot per org so we can join in-memory.
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().split('T')[0]
  const { data: health } = await supabaseAdmin
    .from('org_health_snapshots')
    .select('org_id,health_score,risk_level,snapshot_date')
    .gte('snapshot_date', sevenDaysAgo)
    .order('snapshot_date', { ascending: false })

  const latestHealth = new Map<string, { health_score: number; risk_level: string }>()
  for (const row of health ?? []) {
    if (!latestHealth.has(row.org_id)) latestHealth.set(row.org_id, row)
  }

  const rows = (orgs ?? []).map((o) => {
    const subs = (o.subscriptions ?? []) as Array<{ product: string; tier: string; status: string; seats: number; amount_per_month: number; next_billing_date: string | null }>
    const activeSubs = subs.filter((s) => s.status === 'active' || s.status === 'past_due')
    const mrr = activeSubs.reduce((acc, s) => acc + Number(s.amount_per_month ?? 0), 0)
    const seats = activeSubs.reduce((acc, s) => acc + Number(s.seats ?? 0), 0)
    const tiers = activeSubs.map((s) => s.tier).join(', ') || subs.map((s) => s.tier).join(', ') || '—'
    const subStatus = activeSubs[0]?.status ?? subs[0]?.status ?? o.status
    const credits = (o.credits ?? []) as Array<{ balance: number }>
    const balance = credits.length ? Number(credits[0].balance ?? 0) : 0
    const h = latestHealth.get(o.id)
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      status: o.status,
      sub_status: subStatus,
      tier: tiers,
      seats,
      mrr,
      health_score: h?.health_score ?? null,
      risk_level: h?.risk_level ?? null,
      next_billing_date: activeSubs[0]?.next_billing_date ?? null,
      credit_balance: balance,
    }
  })

  // Filter by tier post-load (cheaper than join).
  const filtered = tier ? rows.filter((r) => r.tier.toLowerCase().includes(tier.toLowerCase())) : rows

  // Default sort by MRR desc.
  filtered.sort((a, b) => b.mrr - a.mrr)

  return NextResponse.json({ rows: filtered })
}

/* ─────────────────────────────────────────────────────────────────
 * POST /api/admin/orgs — create a new organisation
 * Body: { name, billing_email?, contact_phone?, gstin?, slug?,
 *         subscriptions?: [{ product, tier, seats, amount_per_month, status, trial_days }],
 *         starter_credits? }
 * Slug is auto-generated from name if not supplied (and de-duped).
 * ───────────────────────────────────────────────────────────────── */
type SubscriptionInput = {
  product: 'ihrms' | 'icrm' | 'bundle'
  tier?: string
  seats?: number
  amount_per_month?: number
  status?: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled'
  trial_days?: number
}

function slugify(input: string): string {
  return input.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

export async function POST(req: NextRequest) {
  let admin
  try { admin = await requireAdmin() } catch (res) { return res as NextResponse }

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })

  const billing_email = typeof body.billing_email === 'string' ? body.billing_email.trim().toLowerCase() : null
  const contact_phone = typeof body.contact_phone === 'string' ? body.contact_phone.trim() : null
  const gstin = typeof body.gstin === 'string' ? body.gstin.trim().toUpperCase() : null

  // Generate a unique slug
  const baseSlug = typeof body.slug === 'string' && body.slug ? slugify(body.slug) : slugify(name) || 'org'
  let slug = baseSlug
  for (let i = 2; i < 50; i++) {
    const { data: clash } = await supabaseAdmin.from('organisations').select('id').eq('slug', slug).maybeSingle()
    if (!clash) break
    slug = `${baseSlug}-${i}`
  }

  // Insert organisation
  const { data: org, error: orgError } = await supabaseAdmin
    .from('organisations')
    .insert({ name, slug, billing_email, contact_phone, gstin, status: 'active', signup_source: 'admin_panel' })
    .select('id, name, slug, billing_email, status')
    .single()

  if (orgError || !org) {
    return NextResponse.json({ error: orgError?.message ?? 'Failed to create organisation.' }, { status: 500 })
  }

  // Optional: subscriptions
  const subs = Array.isArray(body.subscriptions) ? (body.subscriptions as SubscriptionInput[]) : []
  const created_subs: string[] = []
  for (const s of subs) {
    if (!s.product || !['ihrms', 'icrm', 'bundle'].includes(s.product)) continue
    const trialDays = Number(s.trial_days ?? 14)
    const trialEnds = trialDays > 0 ? new Date(Date.now() + trialDays * 86_400_000).toISOString() : null
    const { error: subErr } = await supabaseAdmin.from('org_subscriptions').insert({
      org_id: org.id,
      product: s.product,
      tier: s.tier || 'starter',
      seats: Number(s.seats ?? 1),
      amount_per_month: Number(s.amount_per_month ?? 0),
      status: s.status ?? 'trial',
      trial_ends_at: trialEnds,
    })
    if (!subErr) created_subs.push(s.product)
  }

  // Optional: starter credits — wallet + matching ledger entry so /credits
  // tab shows a transaction row backing the initial balance, not an
  // unexplained number.
  const starterCredits = Number(body.starter_credits ?? 0)
  if (starterCredits > 0) {
    await supabaseAdmin.from('org_credits').insert({
      org_id: org.id,
      balance: starterCredits,
      total_purchased: starterCredits,
      lifetime_consumed: 0,
    })
    await supabaseAdmin.from('credit_transactions').insert({
      org_id: org.id,
      type: 'promotional',
      amount: starterCredits,
      direction: 'credit',
      reference_type: 'starter_grant',
      reference_id: null,
      balance_after: starterCredits,
      description: 'Starter credits on signup',
      notes: 'Starter credits on signup',
      created_by: admin.adminId,
      user_id: null,
    })
  }

  // Welcome email to billing contact — best-effort. SMTP failure must NOT
  // unwind the org creation, but we record the result in the audit log so
  // a missed email is visible.
  let email_status: 'sent' | 'skipped_no_address' | 'failed' | 'dev_logged' = 'skipped_no_address'
  let email_error: string | null = null
  if (billing_email) {
    try {
      // Build product labels from the requested subs (use the requested list,
      // not just `created_subs`, so the email reflects what the admin asked
      // for even if a sub-row insert silently failed).
      const products = Array.from(
        new Set(
          subs
            .map((s) => PRODUCT_LABEL[s.product])
            .filter(Boolean) as string[],
        ),
      ).flatMap((p) => (p === 'IHRMS + ICRM' ? ['IHRMS', 'ICRM'] : [p]))

      const firstSub = subs[0]
      const trialDays = Number(firstSub?.trial_days ?? 14)
      const trialEndsAt = trialDays > 0 ? new Date(Date.now() + trialDays * 86_400_000).toISOString() : null

      const result = await sendOrgWelcomeEmail(billing_email, {
        orgName: name,
        products,
        tier: firstSub?.tier ?? 'starter',
        seats: Number(firstSub?.seats ?? 1),
        amountPerMonth: Number(firstSub?.amount_per_month ?? 0),
        trialDays,
        trialEndsAt,
        starterCredits: starterCredits || 0,
      })
      email_status = result.delivered ? 'sent' : 'dev_logged'
    } catch (e) {
      email_status = 'failed'
      email_error = (e as Error).message
      console.error('[org-welcome] send failed:', e)
    }
  }

  await audit({
    admin_id: admin.adminId,
    action: 'org.created',
    target_type: 'organisation',
    target_id: org.id,
    payload: {
      name,
      slug,
      billing_email,
      subscriptions: created_subs,
      starter_credits: starterCredits,
      email_status,
      ...(email_error ? { email_error } : {}),
    },
    ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  })

  return NextResponse.json({ data: org, email_status }, { status: 201 })
}
