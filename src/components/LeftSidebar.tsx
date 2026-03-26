import { NavLink } from 'react-router-dom'

const navItems: { to: string; label: string }[] = [
  { to: '/', label: '📝 创作工作台' },
  { to: '/material-bank', label: '灵感库' },
  { to: '/hot-board', label: '🔥 热点看板' },
  { to: '/knowledge-base', label: '作品集' },
  { to: '/accounts', label: '👤 账号管理' },
  { to: '/settings', label: '⚙️ 设置' },
]

export default function LeftSidebar() {
  return (
    <aside className="w-full md:w-64 shrink-0 border-b md:border-r border-border-muted bg-surface min-h-auto md:min-h-screen">
      <div className="p-6">
        <div className="flex items-center min-w-0">
          <img src="/ideashu-logo.svg" alt="IdeaShu" className="h-7 w-auto" />
        </div>
      </div>

      <nav className="px-4 pb-6 md:pb-6 space-y-1 md:space-y-1 md:flex md:flex-col hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              isActive
                ? 'px-3 py-2 rounded-lg bg-primary/10 text-primary font-semibold text-sm'
                : 'px-3 py-2 rounded-lg text-text-secondary hover:bg-canvas transition-colors text-sm font-medium'
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <nav className="px-4 pb-4 flex gap-2 overflow-x-auto md:hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              isActive
                ? 'flex-shrink-0 px-3 py-2 rounded-lg bg-primary/10 text-primary font-semibold text-sm'
                : 'flex-shrink-0 px-3 py-2 rounded-lg text-text-secondary hover:bg-canvas transition-colors text-sm font-medium'
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}

