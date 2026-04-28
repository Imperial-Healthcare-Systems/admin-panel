// Persists the TOTP secret on `employees` once the admin has scanned the QR
// AND submitted a valid 6-digit code. Email OTP must still be valid at this point.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyOtp } from '@/lib/otp'
import { verifyTotp } from '@/lib/totp'
import { authLimiter, checkLimit } from '@/lib/rate-limit'
import { ipFromRequest } from '@/lib/audit'

const schema = z.object({
  email: z.string().email(),
  otp: z.string().regex(/^\d{6}$/),
  challengeToken: z.string().min(10),
  secret: z.string().min(16),
  totp: z.string().regex(/^\d{6}$/),
})

const IMPERIAL_SLUGS = new Set([
  process.env.IMPERIAL_ORG_SLUG ?? 'imperial-healthcare-systems',
  'imperial',
  'imperial-healthcare-systems',
])

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const ip = ipFromRequest(req) ?? 'unknown'
  const limit = await checkLimit(authLimiter, `totp-enroll:${ip}:${parsed.data.email}`)
  if (!limit.ok) return NextResponse.json({ error: 'Too many attempts' }, { status: 429 })

  const email = parsed.data.email.trim().toLowerCase()

  const otpResult = verifyOtp({
    email,
    otp: parsed.data.otp,
    challengeToken: parsed.data.challengeToken,
  })
  if (!otpResult.valid) return NextResponse.json({ error: otpResult.error ?? 'Invalid OTP' }, { status: 401 })

  if (!verifyTotp(parsed.data.totp, parsed.data.secret)) {
    return NextResponse.json({ error: 'Invalid authenticator code' }, { status: 401 })
  }

  const { data: emp } = await supabaseAdmin
    .from('employees')
    .select('id,is_platform_admin,status,totp_enabled,organisation:organisations(slug)')
    .eq('email', email)
    .eq('status', 'active')
    .single()

  const slug = (emp?.organisation as { slug?: string } | null)?.slug
  if (!emp || !emp.is_platform_admin || !slug || !IMPERIAL_SLUGS.has(slug)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (emp.totp_enabled) {
    return NextResponse.json({ error: 'TOTP already enrolled' }, { status: 409 })
  }

  const { error } = await supabaseAdmin
    .from('employees')
    .update({
      totp_secret: parsed.data.secret,
      totp_enabled: true,
      totp_enrolled_at: new Date().toISOString(),
    })
    .eq('id', emp.id)

  if (error) return NextResponse.json({ error: 'Failed to save secret' }, { status: 500 })

  await supabaseAdmin.from('platform_admin_log').insert({
    admin_id: emp.id,
    action: 'totp.enroll',
    target_type: 'self',
    target_id: emp.id,
    ip_address: ip,
  })

  return NextResponse.json({ ok: true })
}
