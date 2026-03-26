import { useMemo, useState } from 'react'
import { loadPosts } from '../lib/ideashuStorage'

export default function DataTrackingPage() {
  const posts = useMemo(() => loadPosts(), [])
  const [likes24h, setLikes24h] = useState(120)

  const totalEdits = useMemo(() => {
    return posts.reduce((acc, p) => acc + p.editHistory.length, 0)
  }, [posts])

  const avgEdits = posts.length ? Math.round(totalEdits / posts.length) : 0

  return (
    <div className="p-8 overflow-hidden bg-canvas min-h-full font-sans">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold">数据追踪</h1>
          <div className="text-sm text-text-secondary mt-1">mock + 本地统计（Phase 2 之后接入真实互动数据 API）</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div className="bg-surface border border-border-muted rounded-2xl p-6">
          <div className="font-bold text-text-main">IdeaShu vs 纯人工（占位）</div>
          <div className="text-sm text-text-secondary mt-2">
            当前只展示基于 Phase 1 posts 的 editHistory 统计，互动数据表单尚未接入。
          </div>

          <div className="mt-5 space-y-4">
            <div className="border border-border-muted rounded-xl bg-canvas/60 p-4">
              <div className="text-sm font-bold text-text-main">评分与互动的相关性（mock）</div>
              <div className="text-sm text-text-secondary mt-2">
                由于缺少真实 likes/collects/comments 数据，这里先用输入值代替。
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="text-sm font-bold text-text-secondary whitespace-nowrap">likes(24h)</div>
                <input
                  type="number"
                  value={likes24h}
                  onChange={(e) => setLikes24h(Number(e.target.value))}
                  className="px-3 py-2 rounded-lg border border-border-muted bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="mt-3 text-sm text-text-secondary">
                当前测算：每均值编辑 {avgEdits} 次，对应 likes/24h= {likes24h}（示例）
              </div>
            </div>

            <div className="border border-border-muted rounded-xl bg-canvas/60 p-4">
              <div className="text-sm font-bold text-text-main">本地帖子统计</div>
              <div className="mt-2 text-sm text-text-secondary">posts 总数：{posts.length}；平均编辑次数：{avgEdits}</div>
            </div>
          </div>
        </div>

        <div className="bg-surface border border-border-muted rounded-2xl p-6">
          <div className="font-bold text-text-main">录入互动数据（占位）</div>
          <div className="text-sm text-text-secondary mt-2">
            后续在知识库详情页发布后录入 24h/72h/7d likes/collects/comments。
          </div>
          <div className="mt-4 space-y-3">
            <div className="h-10 rounded-lg border border-border-muted bg-canvas/60" />
            <div className="h-10 rounded-lg border border-border-muted bg-canvas/60" />
            <div className="h-10 rounded-lg border border-border-muted bg-canvas/60" />
            <button type="button" className="w-full px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90">
              保存互动数据
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

