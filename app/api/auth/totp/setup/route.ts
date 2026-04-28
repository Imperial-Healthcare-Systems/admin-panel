// Returns a fresh TOTP secret + QR code for an admin who hasn't enrolled yet.
// Caller must have just verified their email OTP — proven by passing email + otp + challengeToken.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyOtp } from '@/lib/otp'
import { generateTotpSecret, buildQrDataUrl } from '@/lib/totp'
import { authLimiter, checkLimit } from '@/lib/rate-limit'
import { ipFromRequest } from '@/lib/audit'

const schema = z.object({
  email: z.string().email(),
  otp: z.string().regex(/^\d{6}$/),
  challengeToken: z.string().min(10),
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
  const limit = await checkLimit(authLimiter, `totp-setup:${ip}:${parsed.data.email}`)
  if (!limit.ok) return NextResponse.json({ error: 'Too many attempts' }, { status: 429 })

  const email = parsed.data.email.trim().toLowerCase()
  const otpResult = verifyOtp({
    email,
    otp: parsed.data.otp,
    challengeToken: parsed.data.challengeToken,
  })
  if (!otpResult.valid) {
    return NextResponse.json({ error: otpResult.error ?? 'Invalid OTP' }, { status: 401 })
  }

  const { data: emp } = await supabaseAdmin
    .from('employees')
    .select('id,email,is_platform_admin,status,totp_enabled,organisation:organisations(slug)')
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

  // Generate a fresh secret. We do NOT persist it until /enroll succeeds with a valid TOTP.
  const secret = generateTotpSecret()
  const qrDataUrl = await buildQrDataUrl(email, secret)

  // Diagnostic log — comment out once enrollment is stable.
  console.log(`[totp/setup] new enrollment for ${email}: secret_prefix=${secret.slice(0, 4)}…(${secret.length} chars)`)

  return NextResponse.json({ ok: true, secret, qrDataUrl })
}
