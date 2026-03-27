import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useActiveAccount } from '../contexts/ActiveAccountContext'

export default function TopNav() {
  const { accounts, activeAccountId, setActiveAccountId, addAccount, deleteAccount } = useActiveAccount()
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)

  const activeName = accounts.find((a) => a.id === activeAccountId)?.name ?? '当前账号'

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!accountMenuRef.current?.contains(e.target as Node)) setAccountMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function handleAddAccount() {
    const name = window.prompt('请输入新账号名称（用于区分不同口号/风格）')
    if (!name) return
    addAccount(name)
    setAccountMenuOpen(false)
  }

  function handleDeleteAccount() {
    if (accounts.length <= 1) return
    const ok = window.confirm(`确定删除账号「${activeName}」？此操作不可撤销。`)
    if (!ok) return
    deleteAccount(activeAccountId)
    setAccountMenuOpen(false)
  }

  return (
    <header className="h-12 shrink-0 z-40 bg-surface/95 backdrop-blur border-b border-border-muted font-sans">
      <div className="h-full px-4 md:px-6 flex items-center justify-between">
        <div className="flex items-center min-w-0">
          <img src="/ideashu-logo.svg" alt="IdeaShu" className="h-7 w-auto" />
        </div>

        <nav className="flex items-center gap-5 font-medium text-[13px]">
          <NavLink
            to="/workspace"
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
            to="/hot-fetch"
            className={({ isActive }) =>
              isActive
                ? 'px-4 py-1.5 rounded-lg bg-primary/10 text-primary font-medium'
                : 'px-4 py-1.5 rounded-lg text-text-secondary hover:bg-canvas border border-transparent hover:border-border-muted transition-colors'
            }
          >
            找热点
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
            <span id="ideashu-account-label" className="text-primary shrink-0">
              账号:
            </span>
            <div ref={accountMenuRef} className="relative">
              <button
                type="button"
                id="ideashu-account-select"
                aria-haspopup="listbox"
                aria-expanded={accountMenuOpen}
                aria-labelledby="ideashu-account-label ideashu-account-select"
                onClick={() => setAccountMenuOpen((o) => !o)}
                className="flex max-w-[180px] items-center justify-between gap-2 truncate rounded-md border border-border-muted bg-surface py-1 pl-2 pr-2 text-left text-[12px] font-bold text-text-main outline-none hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-primary/25"
              >
                <span className="truncate">{activeName}</span>
                <span className="shrink-0 text-text-tertiary" aria-hidden>
                  ▾
                </span>
              </button>

              {accountMenuOpen && (
                <div
                  role="listbox"
                  aria-labelledby="ideashu-account-label"
                  className="absolute right-0 top-full z-50 mt-1 min-w-[220px] overflow-hidden rounded-md border border-border-muted bg-surface"
                >
                  <div className="px-1.5 py-1">
                    {accounts.map((a) => {
                      const selected = a.id === activeAccountId
                      return (
                        <button
                          key={a.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            setActiveAccountId(a.id)
                            setAccountMenuOpen(false)
                          }}
                          className={
                            selected
                              ? 'flex w-full items-center gap-2 rounded-[6px] bg-[#FFF0F0] p-2 text-left text-[12px] font-medium text-[#C53030]'
                              : 'flex w-full items-center gap-2 rounded-[6px] p-2 text-left text-[12px] font-medium text-text-main hover:bg-canvas'
                          }
                        >
                          <span
                            className={
                              selected
                                ? 'size-[6px] shrink-0 rounded-full bg-[#E53E3E]'
                                : 'size-[6px] shrink-0 rounded-full bg-border-muted'
                            }
                            aria-hidden
                          />
                          <span className="min-w-0 truncate">{a.name}</span>
                        </button>
                      )
                    })}
                  </div>

                  <div className="border-t-[0.5px] border-border-muted" role="separator" />

                  <div className="px-1.5 py-1">
                    <button
                      type="button"
                      onClick={handleAddAccount}
                      className="flex w-full items-center rounded-[6px] p-2 text-left text-[12px] font-medium text-text-secondary hover:bg-canvas"
                      title="新增一个账号（保存在本机 localStorage）"
                    >
                      + 添加账号
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteAccount}
                      disabled={accounts.length <= 1}
                      className="flex w-full items-center rounded-[6px] p-2 text-left text-[12px] font-medium text-text-tertiary hover:bg-canvas disabled:pointer-events-none disabled:opacity-40"
                      title={accounts.length <= 1 ? '至少保留一个账号' : '删除当前账号（保存在本机 localStorage）'}
                    >
                      删除当前账号
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </nav>
      </div>
    </header>
  )
}

