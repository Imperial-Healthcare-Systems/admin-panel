'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import { Search, LogOut, User } from 'lucide-react'

export function Topbar() {
  const { data: session } = useSession()
  const router = useRouter()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)

  function search(e: React.FormEvent) {
    e.preventDefault()
    if (q.trim()) router.push(`/orgs?q=${encodeURIComponent(q.trim())}`)
  }

  return (
    <header
      className="flex items-center justify-between gap-4 px-4 border-b border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ height: 'var(--topbar-height)' }}
    >
      <form onSubmit={search} className="flex-1 max-w-md">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-dim)]"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search organisations…"
            className="imp-input pl-9 py-1.5"
          />
        </div>
      </form>
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-[var(--color-surface-2)]"
        >
          <div className="w-7 h-7 rounded-full bg-[var(--color-imperial-blue)] flex items-center justify-center text-white text-xs font-semibold">
            {(session?.user?.name ?? 'A').charAt(0).toUpperCase()}
          </div>
          <div className="text-left hidden sm:block">
            <div className="text-xs font-semibold leading-tight">{session?.user?.name}</div>
            <div className="text-[10px] text-[var(--color-text-dim)] leading-tight">{session?.user?.email}</div>
          </div>
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-2 w-56 imp-card overflow-hidden z-50">
            <div className="px-3 py-2 border-b border-[var(--color-border)]">
              <div className="text-xs font-semibold">{session?.user?.name}</div>
              <div className="text-[10px] text-[var(--color-text-dim)] truncate">{session?.user?.email}</div>
            </div>
            <button
              onClick={() => router.push('/settings')}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--color-surface-2)]"
            >
              <User size={14} /> Settings
            </button>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
