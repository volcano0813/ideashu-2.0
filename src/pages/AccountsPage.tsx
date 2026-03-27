import { useMemo, useState } from 'react'
import { useActiveAccount } from '../contexts/ActiveAccountContext'

export default function AccountsPage() {
  const { accounts, activeAccountId, setActiveAccountId, addAccount, deleteAccount } =
    useActiveAccount()
  const [newName, setNewName] = useState('')
  const [showNew, setShowNew] = useState(false)

  const selected = useMemo(
    () => accounts.find((a) => a.id === activeAccountId) ?? accounts[0],
    [accounts, activeAccountId],
  )

  function handleCreate() {
    const name = newName.trim() || '新账号'
    addAccount(name)
    setNewName('')
    setShowNew(false)
  }

  function handleDelete() {
    if (!selected || accounts.length <= 1) return
    if (!window.confirm(`确定删除账号「${selected.name}」？此操作不可撤销。`)) return
    deleteAccount(selected.id)
  }

  return (
    <div className="p-8 overflow-hidden bg-canvas min-h-full font-sans">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold">账号管理</h1>
          <div className="text-sm text-text-secondary mt-1">
            账号列表会保存在本机浏览器；顶部导航可切换当前账号。
          </div>
        </div>
        {!showNew ? (
          <button
            className="px-5 py-2 rounded-[10px] bg-primary text-white font-semibold text-sm hover:bg-primary/90"
            type="button"
            onClick={() => setShowNew(true)}
          >
            新建账号
          </button>
        ) : (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <input
              className="w-[200px] px-3 py-2 rounded-lg border border-border-muted bg-surface text-sm outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="账号名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') {
                  setShowNew(false)
                  setNewName('')
                }
              }}
              autoFocus
            />
            <button
              className="px-4 py-2 rounded-[10px] bg-primary text-white font-semibold text-sm hover:bg-primary/90"
              type="button"
              onClick={handleCreate}
            >
              添加
            </button>
            <button
              className="px-4 py-2 rounded-[10px] border border-border-muted text-text-secondary font-semibold text-sm hover:border-text-main/20 hover:text-text-main"
              type="button"
              onClick={() => {
                setShowNew(false)
                setNewName('')
              }}
            >
              取消
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        <div className="space-y-3">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setActiveAccountId(a.id)}
              className={
                a.id === activeAccountId
                  ? 'w-full text-left rounded-2xl border border-primary/40 bg-primary/5 p-4'
                  : 'w-full text-left rounded-2xl border border-border-muted bg-surface p-4 hover:border-primary/35 hover:bg-canvas transition-colors'
              }
            >
              <div className="text-sm font-black text-text-main">{a.name}</div>
              <div className="text-xs text-text-secondary mt-1">领域：{a.domain}</div>
              <div className="text-xs text-text-secondary mt-1">人设：{a.persona}</div>
            </button>
          ))}
        </div>

        <div className="bg-surface border border-border-muted rounded-2xl p-6 overflow-hidden">
          <div className="text-sm font-bold">{selected ? selected.name : '—'}</div>
          <div className="text-sm text-text-secondary mt-2">领域：{selected?.domain}</div>
          <div className="text-sm text-text-secondary mt-1">人设：{selected?.persona}</div>
          <div className="text-sm text-text-secondary mt-1">
            口头禅：{selected?.catchPhrases?.join(' / ') ?? '—'}
          </div>
          <div className="text-sm text-text-secondary mt-1">调性：{selected?.tone ?? selected?.styleName ?? '—'}</div>
          <div className="text-sm text-text-secondary mt-1">风格：{selected?.styleName}</div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border-muted bg-canvas/60 p-4">
              <div className="text-xs font-bold text-text-secondary">已学习规则</div>
              <div className="text-3xl font-black text-text-main mt-1">{selected?.learnedRules ?? 0}</div>
            </div>
            <div className="rounded-xl border border-border-muted bg-canvas/60 p-4">
              <div className="text-xs font-bold text-text-secondary">趋势来源</div>
              <div className="text-3xl font-black text-text-main mt-1">{selected?.trendSources ?? 0}</div>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <div className="text-sm font-bold">品牌人设与语言风格（占位）</div>
            <textarea
              className="w-full min-h-[120px] px-3 py-2 rounded-lg border border-border-muted bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="用于编辑 brand-voice 配置（Phase 2：ws 提取风格/禁区等）"
              defaultValue=""
            />
            <div className="flex gap-3 flex-wrap items-center">
              <button
                className="px-4 py-2 rounded-lg border border-red-200 text-red-700 font-semibold hover:bg-red-50 disabled:opacity-40 disabled:pointer-events-none"
                type="button"
                disabled={accounts.length <= 1}
                onClick={handleDelete}
                title={accounts.length <= 1 ? '至少保留一个账号' : undefined}
              >
                删除当前账号
              </button>
              <button className="px-4 py-2 rounded-lg bg-text-main text-white font-semibold hover:bg-text-main/90" type="button">
                保存
              </button>
              <button className="px-4 py-2 rounded-lg border border-border-muted text-text-secondary font-semibold hover:border-text-main/20 hover:text-text-main" type="button">
                导出 brand-voice .md
              </button>
            </div>
            <div className="text-xs text-text-secondary">
              导入已有笔记 / 导出文件 / ws 适配将在 `ws-adapter` 待办完成后接入。
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
