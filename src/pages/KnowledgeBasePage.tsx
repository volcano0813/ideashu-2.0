import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useActiveAccount } from '../contexts/ActiveAccountContext'
import { deletePost, loadPosts, type KnowledgePost } from '../lib/ideashuStorage'

const cardTints = [
  { bg: '#FFF8F0', accent: '#E8A87C' },
  { bg: '#F0F7FF', accent: '#7EB8E0' },
  { bg: '#FFF0F3', accent: '#E88FA3' },
  { bg: '#F2FFF0', accent: '#7EC88A' },
  { bg: '#F5F0FF', accent: '#A78BDB' },
  { bg: '#FFFBF0', accent: '#D4B85C' },
]

const CARD_R = '#FF2442'
const CARD_R10 = 'rgba(255,36,66,0.06)'

/**
 * 仅按封面图高锁行高时，扁横图会使右侧「状态+标题+标签+按钮」挤占后正文区高度为 0。
 * 行高取 max(图高, 本值)：高封面仍与图一致，过矮时略加高卡片，左图顶对齐、下方留白。
 */
const PORTFOLIO_ROW_MIN_FOR_BODY_PX = 280

function hashString(input: string) {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0
  }
  return h
}

function formatPortfolioDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

function PortfolioCard({
  post,
  onOpen,
  onCopy,
  onRequestDelete,
}: {
  post: KnowledgePost
  onOpen: () => void
  onCopy: () => void
  onRequestDelete: () => void
}) {
  const seed = post.tags[0] ?? post.id
  const tint = cardTints[Math.abs(hashString(seed)) % cardTints.length]
  const [coverBroken, setCoverBroken] = useState(false)
  const [coverRowHeight, setCoverRowHeight] = useState<number | null>(null)
  const coverImgRef = useRef<HTMLImageElement | null>(null)
  const coverUrl = post.cover?.imageUrl
  const hasCover = Boolean(coverUrl && !coverBroken)

  useEffect(() => {
    setCoverBroken(false)
    setCoverRowHeight(null)
  }, [coverUrl, post.id])

  const syncCoverRowHeight = useCallback(() => {
    const img = coverImgRef.current
    if (!img) return
    setCoverRowHeight(img.offsetHeight)
  }, [])

  useLayoutEffect(() => {
    const img = coverImgRef.current
    if (!img || !coverUrl || coverBroken) return
    if (img.complete && img.naturalHeight > 0) syncCoverRowHeight()
  }, [coverUrl, coverBroken, post.id, syncCoverRowHeight])

  useEffect(() => {
    const img = coverImgRef.current
    if (!img || !coverUrl || coverBroken) return
    const ro = new ResizeObserver(() => syncCoverRowHeight())
    ro.observe(img)
    return () => ro.disconnect()
  }, [coverUrl, coverBroken, post.id, syncCoverRowHeight])

  const rowLayoutPx = useMemo(() => {
    if (!hasCover || coverRowHeight == null) return null
    return Math.max(coverRowHeight, PORTFOLIO_ROW_MIN_FOR_BODY_PX)
  }, [hasCover, coverRowHeight])

  return (
    <div
      className="group relative min-w-0 w-full cursor-pointer overflow-hidden rounded-[14px] border border-border-muted bg-surface transition-[box-shadow] duration-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.06)]"
      style={{ background: tint.bg }}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen()
      }}
    >
      <div
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[4px] opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{ background: tint.accent }}
      />

      <div
        className="flex min-h-0 min-w-0 flex-row items-stretch gap-0"
        style={
          rowLayoutPx != null
            ? { height: rowLayoutPx, minHeight: rowLayoutPx }
            : hasCover
              ? { minHeight: 80 }
              : { minHeight: 160 }
        }
      >
        {/* 左：封面按比例完整展示（不裁切），宽上限约 1.5× 原 200px；行高由图高锁定 */}
        <div className="flex h-full w-fit max-w-[300px] shrink-0 flex-col justify-start border-r border-border-muted/60 bg-canvas/50">
          {coverUrl && !coverBroken ? (
            <img
              ref={coverImgRef}
              src={coverUrl}
              alt=""
              onLoad={syncCoverRowHeight}
              onError={() => {
                setCoverBroken(true)
                setCoverRowHeight(null)
              }}
              className="block h-auto max-h-full max-w-full align-top object-contain object-top transition-[filter] duration-300 group-hover:brightness-[1.02]"
            />
          ) : (
            <div
              className="flex min-h-[120px] min-w-[100px] max-w-[300px] items-center justify-center px-2 text-[11px] text-text-tertiary"
              aria-hidden
            >
              无封面
            </div>
          )}
        </div>

        {/* 右：仅正文区滚动；状态/标题固定；标签在复制全文上方；底栏固定 */}
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 py-3 sm:px-4 sm:py-3.5">
          <div className="shrink-0">
            <div className="text-[11px] font-bold text-text-secondary/90">
              {post.status.toUpperCase()} · {formatPortfolioDate(post.updatedAt)}
            </div>
            <div className="mt-1.5 text-[15px] font-black leading-snug text-text-main">{post.title}</div>
          </div>

          <div className="mt-2 flex min-h-0 flex-1 gap-1.5 overflow-hidden">
            <div className="portfolio-card-body-pane portfolio-card-scroll-side min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg border border-white/40 bg-white/45 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] backdrop-blur-[2px] dark:border-white/10 dark:bg-black/25">
              <div className="text-[13.5px] leading-[1.6] tracking-[0.2px] text-text-secondary whitespace-pre-wrap break-words">
                {post.body || '\u00a0'}
              </div>
            </div>
          </div>

          <div className="mt-auto shrink-0">
            {post.tags.length > 0 ? (
              <div className="mb-2.5 flex flex-wrap gap-[6px]">
                {post.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full px-[10px] py-[3px] text-[11px] font-medium tracking-[0.3px]"
                    style={{ background: tint.bg, color: tint.accent }}
                  >
                    {t.startsWith('#') ? t : `#${t}`}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="flex items-center justify-end gap-2 border-t border-[#F5F5F5] pt-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onCopy()
              }}
              className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-white/60"
              style={{ background: CARD_R10, color: CARD_R }}
            >
              复制全文
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRequestDelete()
              }}
              className="rounded-full p-1.5 text-[#CCC] transition-colors hover:bg-white/50 hover:text-[#FF2442]"
              aria-label="删除"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function KnowledgeBasePage() {
  const { activeAccountId } = useActiveAccount()
  const [posts, setPosts] = useState<KnowledgePost[]>(() => loadPosts(activeAccountId))
  const [search, setSearch] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  function refresh() {
    setPosts(loadPosts(activeAccountId))
  }

  useEffect(() => {
    refresh()
    setSearch('')
    setDeleteId(null)
    setOpenId(null)
  }, [activeAccountId])

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

  async function copyPost(p: KnowledgePost) {
    const full = `${p.title}\n\n${p.body}`
    try {
      await navigator.clipboard.writeText(full)
    } catch {
      // ignore
    }
  }

  const openedPost = useMemo(() => {
    if (!openId) return null
    return posts.find((p) => p.id === openId) ?? null
  }, [openId, posts])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas p-4 font-sans md:p-6">
      <div className="mx-auto flex min-h-0 min-w-0 w-full max-w-[min(100%,1920px)] flex-1 flex-col overflow-hidden px-1 sm:px-3 lg:px-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs font-bold text-text-secondary whitespace-nowrap">共 {posts.length} 篇</div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 w-[min(100%,420px)] border-0 border-b border-border-muted bg-transparent py-2 text-sm text-text-main outline-none transition-colors placeholder:text-text-tertiary focus:border-primary"
            placeholder="搜索标题/正文/标签…"
          />
        </div>

        <div className="min-h-0 min-w-0 w-full flex-1 overflow-y-auto overflow-x-hidden pr-1">
          <div className="grid w-full min-w-0 grid-cols-1 items-start gap-4 sm:gap-5 md:grid-cols-2 md:gap-6 lg:gap-8">
            {filtered.map((p) => (
              <PortfolioCard
                key={p.id}
                post={p}
                onOpen={() => setOpenId(p.id)}
                onCopy={() => void copyPost(p)}
                onRequestDelete={() => setDeleteId(p.id)}
              />
            ))}
          </div>
          {filtered.length === 0 && (
            <div className="mt-4 text-center rounded-[14px] border border-border-muted bg-surface p-8 text-text-secondary">
              暂无匹配内容
            </div>
          )}
        </div>
      </div>

      {openedPost !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 px-4 backdrop-blur-sm"
          onClick={() => setOpenId(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-[820px] max-h-[80svh] overflow-hidden rounded-[20px] border border-border-muted bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.12)]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="作品详情"
          >
            <div className="flex min-h-0 flex-col">
              <div className="flex items-center justify-between gap-3 border-b border-border-muted px-6 py-4">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-text-secondary/90">
                    {openedPost.status.toUpperCase()} · {formatPortfolioDate(openedPost.updatedAt)}
                  </div>
                  <div className="mt-1 text-base font-black text-text-main line-clamp-2">{openedPost.title}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenId(null)}
                  className="rounded-full p-2 text-text-tertiary hover:bg-canvas hover:text-text-main transition-colors"
                  aria-label="关闭"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M18 6L6 18M6 6l12 12"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>

              <div className="min-h-0 overflow-y-auto px-6 py-5">
                {openedPost.cover?.imageUrl ? (
                  <img
                    src={openedPost.cover.imageUrl}
                    alt=""
                    className="mb-4 w-full max-h-[360px] rounded-2xl object-cover border border-border-muted"
                  />
                ) : null}

                {openedPost.tags.length > 0 ? (
                  <div className="mb-4 flex flex-wrap gap-2">
                    {openedPost.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full px-3 py-1 text-[11px] font-semibold bg-primary/10 text-primary"
                      >
                        {t.startsWith('#') ? t : `#${t}`}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="whitespace-pre-wrap text-[14px] leading-[1.9] tracking-[0.2px] text-text-main">
                  {openedPost.body}
                </div>
              </div>

              <div className="shrink-0 border-t border-border-muted px-6 py-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void copyPost(openedPost)}
                  className="rounded-full px-4 py-2 text-sm font-medium transition-colors hover:bg-white/60"
                  style={{ background: CARD_R10, color: CARD_R }}
                >
                  复制全文
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpenId(null)
                    setDeleteId(openedPost.id)
                  }}
                  className="rounded-full px-4 py-2 text-sm font-medium border border-red-200 text-red-700 hover:bg-red-50 transition-colors"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 px-4 backdrop-blur-sm"
          onClick={() => setDeleteId(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-[400px] rounded-[20px] border border-border-muted bg-surface overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.1)]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="删除确认"
          >
            <div className="px-7 pt-8 pb-6">
              <p className="text-base font-semibold text-text-main">确认删除这篇作品？</p>
              <p className="mt-2 text-sm text-text-secondary">删除后无法从作品集恢复。</p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDeleteId(null)}
                  className="rounded-full px-5 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-canvas"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (deleteId) deletePost(activeAccountId, deleteId)
                    setDeleteId(null)
                    refresh()
                  }}
                  className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
