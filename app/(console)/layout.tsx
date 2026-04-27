import { redirect } from 'next/navigation'
import { getSessionOrNull } from '@/lib/session'
import { AuthProvider } from '@/components/providers/AuthProvider'
import { Sidebar } from '@/components/layout/Sidebar'
import { Topbar } from '@/components/layout/Topbar'

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionOrNull()
  if (!session) redirect('/login')

  return (
    <AuthProvider>
      <div className="flex min-h-screen bg-[var(--color-bg)]">
        <Sidebar />
        <div className="flex-1 flex flex-col">
          <Topbar />
          <main className="flex-1 p-6 overflow-x-hidden">{children}</main>
        </div>
      </div>
    </AuthProvider>
  )
}
