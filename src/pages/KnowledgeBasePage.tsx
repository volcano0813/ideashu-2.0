import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadPosts, setPendingDraft, type KnowledgePost } from '../lib/ideashuStorage'
import type { Draft } from '../components/XhsPostEditor'

function draftFromPost(p: KnowledgePost): Draft {
  return {
    title: p.title,
    body: p.body,
    tags: p.tags,
    cover: p.cover,
  }
}

export default function KnowledgeBasePage() {
  const navigate = useNavigate()
  const [posts] = useState<KnowledgePost[]>(() => loadPosts())
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return posts
    return posts.filter((p) => {
      return (
        p.title.toLowerCase().includes(term) ||
        p.body.toLowerCase().includes(term) ||
        p.tags.join(' ').toLowerCase().includes(term)
      )
    })
  }, [posts, search])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas p-4 font-sans">
      <div className="mx-auto flex min-h-0 w-full max-w-[960px] flex-1 flex-col overflow-hidden">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-main">作品集</h1>
            <div className="text-sm text-text-secondary mt-1">读取用户编辑后的草稿/最终内容（localStorage）</div>
          </div>
          <div className="text-xs font-bold text-text-secondary whitespace-nowrap">共 {posts.length} 篇</div>
        </div>

        <div className="mb-5 flex items-center justify-between gap-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-[min(100%,420px)] border-0 border-b border-border-muted bg-transparent py-2 text-sm text-text-main outline-none transition-colors placeholder:text-text-tertiary focus:border-primary"
            placeholder="搜索标题/正文/标签…"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filtered.map((p) => (
              <div key={p.id} className="bg-surface border border-border-muted rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-text-secondary">
                    {p.status.toUpperCase()} · {new Date(p.updatedAt).toLocaleString()}
                  </div>
                  <div className="text-lg font-black text-text-main mt-2 line-clamp-2">
                    {p.title}
                  </div>
                  <div className="text-sm text-text-secondary mt-2 line-clamp-3 whitespace-pre-wrap">
                    {p.body}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {p.tags.slice(0, 4).map((t) => (
                  <span key={t} className="px-2 py-1 rounded-full border border-border-muted bg-canvas/80 text-[11px] font-semibold text-text-secondary">
                    {t}
                  </span>
                ))}
              </div>

              <div className="mt-4 flex gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={async () => {
                    const full = `${p.title}\n\n${p.body}`
                    try {
                      await navigator.clipboard.writeText(full)
                    } catch {
                      // ignore
                    }
                  }}
                  className="px-4 py-2 rounded-lg border border-border-muted text-text-secondary font-semibold text-sm hover:border-text-main/20 hover:text-text-main transition-colors"
                >
                  复制全文
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingDraft(draftFromPost(p))
                    navigate('/')
                  }}
                  className="px-4 py-2 rounded-lg bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors"
                >
                  基于此创作
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-2 text-center bg-surface border border-border-muted rounded-2xl p-8 text-text-secondary">
              暂无匹配内容
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}

