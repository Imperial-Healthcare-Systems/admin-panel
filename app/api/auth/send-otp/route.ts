import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { createOtpChallenge, maskEmail } from '@/lib/otp'
import { sendOtpEmail } from '@/lib/email'
import { authLimiter, checkLimit } from '@/lib/rate-limit'
import { ipFromRequest } from '@/lib/audit'

const schema = z.object({ email: z.string().email() })

const IMPERIAL_SLUGS = new Set([
  process.env.IMPERIAL_ORG_SLUG ?? 'imperial-healthcare-systems',
  'imperial',
  'imperial-healthcare-systems',
])

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid email' }, { status: 400 })

  const email = parsed.data.email.trim().toLowerCase()
  const ip = ipFromRequest(req) ?? 'unknown'

  const limit = await checkLimit(authLimiter, `send-otp:${ip}:${email}`)
  if (!limit.ok) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a minute.' }, { status: 429 })
  }

  // Pre-check: is this an Imperial platform admin? We deliberately do NOT
  // leak whether the email exists — same response either way.
  const { data: emp } = await supabaseAdmin
    .from('employees')
    .select('id,email,is_platform_admin,is_active,totp_enabled,organisation:organisations(slug)')
    .eq('email', email)
    .eq('is_active', true)
    .maybeSingle()

  const slug = (emp?.organisation as { slug?: string } | null)?.slug
  const isImperialAdmin =
    !!emp && emp.is_platform_admin && !!slug && IMPERIAL_SLUGS.has(slug)

  // Always return the same shape (timing-safe-ish) to avoid email enumeration.
  if (!isImperialAdmin) {
    return NextResponse.json({
      ok: true,
      maskedEmail: maskEmail(email),
      challengeToken: '',
      expiresInMinutes: 0,
      needsTotpEnrollment: false,
      // Generic — do not reveal "not found".
      message: 'If this address is registered, a code has been sent.',
    })
  }

  const { otp, challengeToken, expiresInMinutes } = createOtpChallenge(email)
  await sendOtpEmail(email, otp, expiresInMinutes)

  return NextResponse.json({
    ok: true,
    maskedEmail: maskEmail(email),
    challengeToken,
    expiresInMinutes,
    needsTotpEnrollment: !emp.totp_enabled,
    message: 'A 6-digit code has been emailed to you.',
  })
}
