import { NavLink } from 'react-router-dom'
import { useActiveAccount } from '../contexts/ActiveAccountContext'
import { MOCK_ACCOUNTS } from '../lib/accounts'

export default function TopNav() {
  const { activeAccountId, setActiveAccountId } = useActiveAccount()

  return (
    <header className="h-12 shrink-0 z-40 bg-surface/95 backdrop-blur border-b border-border-muted font-sans">
      <div className="h-full px-4 md:px-6 flex items-center justify-between">
        <div className="flex items-center min-w-0">
          <img src="/ideashu-logo.svg" alt="IdeaShu" className="h-7 w-auto" />
        </div>

        <nav className="flex items-center gap-5 font-medium text-[13px]">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              isActive
                ? 'px-4 py-1.5 rounded-lg bg-primary/10 text-primary font-medium'
                : 'px-4 py-1.5 rounded-lg text-text-secondary hover:bg-canvas border border-transparent hover:border-border-muted transition-colors'
            }
          >
            创作工作台
          </NavLink>
          <NavLink
            to="/material-bank"
            className={({ isActive }) =>
              isActive
                ? 'px-4 py-1.5 rounded-lg bg-primary/10 text-primary font-medium'
                : 'px-4 py-1.5 rounded-lg text-text-secondary hover:bg-canvas border border-transparent hover:border-border-muted transition-colors'
            }
          >
            灵感库
          </NavLink>
          <NavLink
            to="/knowledge-base"
            className={({ isActive }) =>
              isActive
                ? 'px-4 py-1.5 rounded-lg bg-primary/10 text-primary font-medium'
                : 'px-4 py-1.5 rounded-lg text-text-secondary hover:bg-canvas border border-transparent hover:border-border-muted transition-colors'
            }
          >
            作品集
          </NavLink>

          <div className="flex items-center gap-2 text-[12px] text-text-secondary whitespace-nowrap">
            <label htmlFor="ideashu-account-select" className="text-primary shrink-0">
              账号:
            </label>
            <select
              id="ideashu-account-select"
              value={activeAccountId}
              onChange={(e) => setActiveAccountId(e.target.value)}
              className="max-w-[140px] truncate rounded-md border border-border-muted bg-surface py-1 pl-2 pr-7 text-[12px] font-bold text-text-main outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
            >
              {MOCK_ACCOUNTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </nav>
      </div>
    </header>
  )
}

