// Centralised session helper for API routes. Always returns the admin id or
// throws an `Unauthorized` Response — keeps every mutation honest about the
// "verify session via getServerSession" rule from Section 10.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'

export async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    throw NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return {
    adminId: (session.user as { id: string }).id,
    email: session.user.email,
    name: session.user.name,
    role: (session.user as { role?: string }).role,
  }
}

export async function getSessionOrNull() {
  return getServerSession(authOptions)
}
