import { Outlet } from 'react-router-dom'
import { Nav } from './Nav'

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-4 border-b border-mc-border flex items-center gap-3">
        <h1 className="text-lg font-semibold text-mc-purple">MyClaw</h1>
        <span className="text-xs text-mc-text-muted">Agent Console</span>
        <div className="ml-auto">
          <Nav />
        </div>
      </header>
      <main className="flex-1 max-w-[1200px] w-full mx-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
