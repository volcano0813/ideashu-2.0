import { useMemo } from 'react'
import { useActiveAccount } from '../contexts/ActiveAccountContext'
import { MOCK_ACCOUNTS } from '../lib/accounts'

export default function AccountsPage() {
  const { activeAccountId, setActiveAccountId } = useActiveAccount()

  const selected = useMemo(
    () => MOCK_ACCOUNTS.find((a) => a.id === activeAccountId) ?? MOCK_ACCOUNTS[0],
    [activeAccountId],
  )

  return (
    <div className="p-8 overflow-hidden bg-canvas min-h-full font-sans">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold">账号管理</h1>
          <div className="text-sm text-text-secondary mt-1">mock 页面：用于 Phase 2 产品化落地</div>
        </div>
        <button className="px-5 py-2 rounded-[10px] bg-primary text-white font-semibold text-sm hover:bg-primary/90" type="button">
          新建账号
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        <div className="space-y-3">
          {MOCK_ACCOUNTS.map((a) => (
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
            <div className="flex gap-3 flex-wrap">
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
