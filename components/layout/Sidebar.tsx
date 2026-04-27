'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Building2,
  Sparkles,
  Coins,
  TrendingUp,
  Receipt,
  Cloud,
  HeartPulse,
  ScrollText,
  Settings,
  ShieldCheck,
} from 'lucide-react'

type NavItem = { href: string; label: string; icon: React.ComponentType<{ size?: number }> }
type NavSection = { title: string; items: NavItem[] }

const sections: NavSection[] = [
  {
    title: 'Operations',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/orgs', label: 'Organisations', icon: Building2 },
      { href: '/features', label: 'Features', icon: Sparkles },
      { href: '/credits', label: 'Credits', icon: Coins },
    ],
  },
  {
    title: 'Finance',
    items: [
      { href: '/revenue', label: 'Revenue', icon: TrendingUp },
      { href: '/refunds', label: 'Refunds', icon: Receipt },
      { href: '/vendors', label: 'Vendors', icon: Cloud },
    ],
  },
  {
    title: 'Customer',
    items: [{ href: '/health', label: 'Health', icon: HeartPulse }],
  },
  {
    title: 'Security',
    items: [{ href: '/audit', label: 'Audit Log', icon: ScrollText }],
  },
  {
    title: 'System',
    items: [{ href: '/settings', label: 'Settings', icon: Settings }],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  return (
    <aside
      className="hidden lg:flex flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ width: 'var(--sidebar-width)', minHeight: '100vh' }}
    >
      <div className="flex items-center gap-2 px-4 h-[var(--topbar-height)] border-b border-[var(--color-border)]">
        <div className="w-8 h-8 rounded-md bg-[var(--color-imperial-blue)] flex items-center justify-center">
          <ShieldCheck size={16} color="white" />
        </div>
        <div>
          <div className="font-semibold text-sm">Imperial Admin</div>
          <div className="text-[10px] text-[var(--color-text-dim)] uppercase tracking-wider">Control plane</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-4">
        {sections.map((section) => (
          <div key={section.title} className="mb-6">
            <div className="px-4 mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-dim)]">
              {section.title}
            </div>
            <ul>
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/')
                const Icon = item.icon
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                        active
                          ? 'bg-[var(--color-surface-2)] text-[var(--color-text)] border-l-2 border-[var(--color-imperial-blue-light)]'
                          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] border-l-2 border-transparent'
                      }`}
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-dim)]">
        v1.0 · CONFIDENTIAL
      </div>
    </aside>
  )
}
