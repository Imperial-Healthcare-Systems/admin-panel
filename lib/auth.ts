// Decision Gate #1 → apex domain `imperialhealthcare.cloud` (NEXTAUTH_URL).
// Decision Gate #2 → TOTP mandatory: `totp` is required when employees.totp_enabled = TRUE.
//                    First-time users must enroll via /api/auth/totp/enroll BEFORE this provider succeeds.
import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyOtp } from '@/lib/otp'
import { verifyTotp } from '@/lib/totp'

const IMPERIAL_SLUGS = new Set([
  process.env.IMPERIAL_ORG_SLUG ?? 'imperial-healthcare-systems',
  'imperial',
  'imperial-healthcare-systems',
])

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'email-otp-totp',
      credentials: {
        email: { type: 'email' },
        otp: { type: 'text' },
        challengeToken: { type: 'text' },
        totp: { type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.otp || !credentials?.challengeToken) return null
        const email = credentials.email.trim().toLowerCase()

        // 1. Verify email OTP
        const otpResult = verifyOtp({
          email,
          otp: credentials.otp,
          challengeToken: credentials.challengeToken,
        })
        if (!otpResult.valid) return null

        // 2. Look up Imperial employee with platform admin flag
        const { data: emp } = await supabaseAdmin
          .from('employees')
          .select(
            'id,email,full_name,role,is_platform_admin,status,org_id,totp_secret,totp_enabled,organisation:organisations(slug)',
          )
          .eq('email', email)
          .eq('status', 'active')
          .single()

        if (!emp) return null

        const slug = (emp.organisation as { slug?: string } | null)?.slug
        const isImperialOrg = slug ? IMPERIAL_SLUGS.has(slug) : false

        if (!emp.is_platform_admin || !isImperialOrg) return null

        // 3. TOTP mandatory (Decision Gate #2). If not enrolled yet, the client
        //    must call /api/auth/totp/enroll first; that route flips totp_enabled.
        if (!emp.totp_enabled || !emp.totp_secret) return null
        if (!credentials.totp) return null
        if (!verifyTotp(credentials.totp, emp.totp_secret)) return null

        // 4. Audit successful login (best-effort; never block on this)
        await supabaseAdmin.from('platform_admin_log').insert({
          admin_id: emp.id,
          action: 'login',
          target_type: 'self',
          target_id: emp.id,
        })

        return {
          id: emp.id,
          email: emp.email,
          name: emp.full_name || emp.email,
          role: emp.role,
        } as { id: string; email: string; name: string; role: string }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id
        token.role = (user as { role?: string }).role
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        ;(session.user as { id?: string }).id = token.id as string
        ;(session.user as { role?: string }).role = token.role as string
      }
      return session
    },
  },
  pages: { signIn: '/login', error: '/login' },
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 }, // 8-hour sessions (§8)
  secret: process.env.NEXTAUTH_SECRET,
}
