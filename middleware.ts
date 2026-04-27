// §4.2 — Protect all console routes; unauthenticated requests bounce to /login.
import { withAuth } from 'next-auth/middleware'

export default withAuth({
  pages: { signIn: '/login' },
  callbacks: { authorized: ({ token }) => !!token?.id },
})

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/orgs/:path*',
    '/features/:path*',
    '/credits/:path*',
    '/revenue/:path*',
    '/vendors/:path*',
    '/health/:path*',
    '/refunds/:path*',
    '/audit/:path*',
    '/settings/:path*',
  ],
}
