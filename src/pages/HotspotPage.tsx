import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ensureOpenClawConnected,
  invalidateOpenClawConnectPromise,
  openclaw,
} from '../lib/openclawSingleton'
import type { TrendSignal } from '../lib/openclawClient'
import FilterBar, { type HotspotSortKey } from '../components/hotspot/FilterBar'
import HotCard from '../components/hotspot/HotCard'
import { hotTopicFromTrendSignal } from '../components/hotspot/hotspotViewModel'
import { useActiveAccount } from '../contexts/ActiveAccountContext'
import type { HotTopic } from '../types/hotspot'

function hotspotCacheKey(accountId: string) {
  return `ideashu.hotspot.cache.${accountId}.v1`
}

type HotspotCache = {
  fetchedAt: string | null
  signals: TrendSignal[]
}

function loadHotspotCache(accountId: string): HotspotCache {
  if (!accountId) return { fetchedAt: null, signals: [] }
  try {
    const raw = localStorage.getItem(hotspotCacheKey(accountId))
    if (!raw) return { fetchedAt: null, signals: [] }
    const parsed = JSON.parse(raw) as Partial<HotspotCache>
    return {
      fetchedAt: typeof parsed.fetchedAt === 'string' ? parsed.fetchedAt : null,
      signals: Array.isArray(parsed.signals) ? parsed.signals : [],
    }
  } catch {
    return { fetchedAt: null, signals: [] }
  }
}

function saveHotspotCache(accountId: string, cache: HotspotCache) {
  if (!accountId) return
  try {
    localStorage.setItem(hotspotCacheKey(accountId), JSON.stringify(cache))
  } catch {
    // ignore quota / private mode
  }
}

function relativeTimeLabel(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const ts = d.getTime()
  if (!Number.isFinite(ts)) return ''
  const diffMs = Date.now() - ts
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} 小时前`
  const days = Math.floor(hrs / 24)
  return `${days} 天前`
}

const fence = '```'

/** 与 OpenClaw ideashu-v5 SKILL「热点抓取」章节对齐，追加在用户消息末尾 */
const HOTSPOT_OUTPUT_REQUIREMENT = `

【输出要求（必执行）】请严格按 ideashu-v5「热点抓取」规则执行。
【领域对齐】上文「当前创作账号」的名称与领域为唯一依据：检索关键词、筛选与 json:topics 每条选题必须与该账号领域高度相关；禁止沿用其它账号、历史会话或无关领域的热点。
【核心原则】找的是「什么内容/话题在社交平台上火」，不是行业新闻；帮创作者发现可写选题，不做行业简报。
【数据源·按优先级尽量覆盖】① Google 搜索 site:xiaohongshu.com + 账号领域关键词（web_fetch，可组合 2～3 组不同角度；tbs=qdr:w 最近一周或 tbs=qdr:d 最近一天），提取帖子标题、小红书链接作 sourceUrl、大致发布时间；② 微博热搜（agent-browser 打开 s.weibo.com/top/summary 等，筛与领域相关条目）；③ 百度热搜 top.baidu.com/board；④ 知乎热榜 www.zhihu.com/hot；⑤ Google Trends（trends.google.com/trending?geo=CN&hl=zh-CN）；⑥ 可选：仅 AI/科技类账号再查 GitHub Trending。不得以缺少某单一 key 为由拒绝输出；用网关已可用的 web_fetch / agent-browser / 搜索完成查证。
【热度评分 heatScore 0–100】综合：跨源出现约 30%（同一话题在 2+ 数据源被提及可加分）、新鲜度约 25%（6h 内 / 24h 内 / 3 天内递减）、领域匹配约 25%、内容空间约 20%（是否适合小红书个人体验向内容）。
【过滤与排序】排除 brand-voice「选题禁区」；排除 heatScore 低于 50 的条目；优先保留有 sourceUrl（尤其小红书链接）的条目；按 heatScore 从高到低排序后，**最终输出 5～8 条**（不足 5 条须继续检索或说明缺口，不要超过 8 条凑数低质项）。
【回复结构】先用自然语言简要列出每条（标题+来源+热度+建议角度），**末尾**追加唯一 fenced 块：第一行 ${fence}json:topics，下一行起为 JSON 数组。
【每条 JSON 字段】须含：id（数字）、title、source（取值示例：小红书/微博热搜/百度热搜/知乎热榜/Google Trends/综合）、sourceUrl（真实可点击 https；**禁止编造**，无则 ""）、angle（须具体到小红书怎么写、什么结构，勿只写「可以做一期 XX」）、hook、heatScore、timing、timingDetail、materialMatch（bool）、materialCount（number）。可在能核对原文时间时加 publishedAt（ISO 8601），不可核对则省略。
【同步】输出 json:topics 后按 SKILL 要求执行 sync-client 推送到前端（若环境已配置）。
禁止仅用「收到」「等待」等无选题正文的回复。`

function topicPublishedAtMs(t: HotTopic): number {
  const iso = t.source.primarySource.publishedAt
  if (!iso || !iso.trim()) return 0
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function categoriesFromAccountDomain(domain?: string) {
  const raw = (domain ?? '').trim()
  if (!raw || raw === '未设置') return []
  const parts = raw
    .split(/[,\s/|、，；;]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6)
  return parts.map((p) => ({ key: p, label: p }))
}

export default function HotspotPage() {
  const { activeAccount, activeAccountId } = useActiveAccount()
  const [gatewayReady, setGatewayReady] = useState(false)
  const [connectAttempted, setConnectAttempted] = useState(false)
  const [sending, setSending] = useState(false)
  const [fetchedAt, setFetchedAt] = useState<string | null>(() => loadHotspotCache(activeAccountId).fetchedAt)
  const [signals, setSignals] = useState<TrendSignal[]>(() => loadHotspotCache(activeAccountId).signals)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set())
  const fetchTimeoutRef = useRef<number | null>(null)
  /** 本轮是否在等热点结果：`topics` 门控与 assistant_reply 兜底均看它；成功/超时/终态失败时清除 */
  const hotspotAwaitingTopicsRef = useRef(false)
  /** 与 awaiting 同步置位；用于与其它页面逻辑对齐，成功/超时/终态失败时与 awaiting 一并清除 */
  const hotspotFetchSendingRef = useRef(false)

  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [sortKey, setSortKey] = useState<HotspotSortKey>('time')
  const [fetchError, setFetchError] = useState<string | null>(null)
  /** null=未探测；true=Vite 已挂 __openclaw_device_auth 且读到 token；false=404/失败（多为未用 Vite 打开页面） */
  const [deviceAuthOk, setDeviceAuthOk] = useState<boolean | null>(null)

  function clearFetchTimeout() {
    if (fetchTimeoutRef.current != null) {
      window.clearTimeout(fetchTimeoutRef.current)
      fetchTimeoutRef.current = null
    }
  }

  useEffect(() => {
    const unsub = openclaw.onConnectionChange((ready) => setGatewayReady(ready))
    let cancelled = false
    void ensureOpenClawConnected().finally(() => {
      if (cancelled) return
      setConnectAttempted(true)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  /** 切换账号：与单例 openclaw 对齐网关状态，并重置自动抓取以便新账号领域再抓一次 */
  useEffect(() => {
    // 清掉流式 buffer / 去重指纹，避免上一账号未完成的回复或相同正文被误判为重复而不派发 topics
    openclaw.resetAssistantStreamState()
    setGatewayReady(openclaw.isReady())
    const cached = loadHotspotCache(activeAccountId)
    setFetchedAt(cached.fetchedAt)
    setSignals(cached.signals)
    setDismissedIds(new Set())
    setFetchError(null)
    setSending(false)
    clearFetchTimeout()
    hotspotAwaitingTopicsRef.current = false
    hotspotFetchSendingRef.current = false
    let cancelled = false
    void ensureOpenClawConnected().finally(() => {
      if (cancelled) return
      setGatewayReady(openclaw.isReady())
      setConnectAttempted(true)
    })
    return () => {
      cancelled = true
    }
  }, [activeAccountId])

  useEffect(() => {
    if (!connectAttempted || gatewayReady) return
    let cancelled = false
    setDeviceAuthOk(null)
    void fetch('/__openclaw_device_auth', { method: 'GET', cache: 'no-store' })
      .then((r) => {
        if (cancelled) return
        setDeviceAuthOk(r.ok)
      })
      .catch(() => {
        if (cancelled) return
        setDeviceAuthOk(false)
      })
    return () => {
      cancelled = true
    }
  }, [connectAttempted, gatewayReady])

  function handleReconnectGateway() {
    setFetchError(null)
    setDeviceAuthOk(null)
    hotspotAwaitingTopicsRef.current = false
    hotspotFetchSendingRef.current = false
    setConnectAttempted(false)
    invalidateOpenClawConnectPromise()
    openclaw.disconnect()
    void ensureOpenClawConnected().finally(() => setConnectAttempted(true))
  }

  useEffect(() => {
    const unsub = openclaw.onEvent((evt) => {
      // topics 事件：只要还在 sending 状态就接收，不依赖 ref 守门
      // （因为流式中间的 assistant_reply 可能已经错误地清了 ref）
      if (evt.type === 'topics' && evt.topics && evt.topics.length > 0) {
        hotspotAwaitingTopicsRef.current = false
        hotspotFetchSendingRef.current = false
        clearFetchTimeout()
        setFetchError(null)
        setSignals(evt.topics)
        const nextFetchedAt = new Date().toISOString()
        setFetchedAt(nextFetchedAt)
        saveHotspotCache(activeAccountId, { fetchedAt: nextFetchedAt, signals: evt.topics })
        setSending(false)
        return
      }
      // assistant_reply：流式过程中不做任何判断，完全靠 topics 事件和 90s 超时
      // 不再尝试从 assistant_reply 里解析 topics（避免中间态误判）
    })
    return () => unsub()
  }, [activeAccountId])

  const canFetch = gatewayReady && !sending

  const fetchHot = useCallback(() => {
    if (!openclaw.isReady()) return
    // New capture should not inherit previous "hidden" topics.
    setDismissedIds(new Set())
    setSignals([])
    setFetchedAt(null)
    setFetchError(null)
    clearFetchTimeout()
    fetchTimeoutRef.current = window.setTimeout(() => {
      fetchTimeoutRef.current = null
      hotspotAwaitingTopicsRef.current = false
      hotspotFetchSendingRef.current = false
      setSending((cur) => {
        if (!cur) return cur
        setFetchError(
          '抓取超时：仍未得到可用的 json:topics。请确认助手已按 SKILL 多源检索（Google+小红书站内、微博/百度/知乎热榜等）并输出 5～8 条、heatScore≥50；sourceUrl 须真实 https 或可空字符串。请检查网关联网工具与 ideashu-v5 Skill 是否生效，或稍后重试。',
        )
        return false
      })
    }, 90_000)
    hotspotAwaitingTopicsRef.current = true
    hotspotFetchSendingRef.current = true
    setSending(true)
    const dRaw = (activeAccount.domain ?? '').trim()
    const d = dRaw.replace(/^\s*(领域|domain)\s*[:：=]\s*/i, '')
    // Skill 触发词：以「找热点 + 关键词/领域」贴近 ideashu-v5；末尾追加硬性输出要求以提高 json:topics 产出率
    const parts = ['找热点']
    if (d && d !== '未设置') parts.push(d)
    const accountContext = `【当前创作账号：${activeAccount.name}（领域：${activeAccount.domain ?? '未设置'}）】\n`
    const message = accountContext + parts.join(' ') + HOTSPOT_OUTPUT_REQUIREMENT
    const sent = openclaw.send(message)
    if (!sent) {
      clearFetchTimeout()
      hotspotAwaitingTopicsRef.current = false
      hotspotFetchSendingRef.current = false
      setSending(false)
      setFetchError('网关未就绪，抓取请求未发出。请稍后重试，或点击「重新连接网关」。')
    }
  }, [activeAccount.domain, activeAccount.name, activeAccountId])

  useEffect(() => {
    return () => {
      clearFetchTimeout()
    }
  }, [])

  const categories = useMemo(() => {
    const fromDomain = categoriesFromAccountDomain(activeAccount.domain)
    return [{ key: 'all', label: '全部' }, ...fromDomain]
  }, [activeAccount.domain])

  const signalsForUi = signals

  const topics: HotTopic[] = useMemo(() => {
    const at = fetchedAt ?? new Date().toISOString()
    return signalsForUi.map((s) => hotTopicFromTrendSignal(s, at))
  }, [signalsForUi, fetchedAt])

  const visible = useMemo(() => {
    const filtered = topics.filter((t) => !dismissedIds.has(t.id))
    const byCategory =
      activeCategory === 'all' ? filtered : filtered.filter((t) => (t.category || '').includes(activeCategory))
    const sorted = [...byCategory].sort((a, b) => {
      if (sortKey === 'heat') return b.heat.score - a.heat.score
      const tb = topicPublishedAtMs(b)
      const ta = topicPublishedAtMs(a)
      if (tb !== ta) return tb - ta
      return b.heat.score - a.heat.score
    })
    return sorted
  }, [topics, dismissedIds, activeCategory, sortKey])

  const fetchedLabel = useMemo(() => relativeTimeLabel(fetchedAt), [fetchedAt])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas p-4 font-sans">
      <div className="mx-auto flex min-h-0 w-full max-w-[960px] flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <div className="text-2xl font-black text-text-main">热点抓取</div>
              <div className="mt-1 text-[13px] font-semibold text-text-tertiary">
                每次 5～8 条 · heatScore≥50 · 多源检索 · 须与当前 TopNav 账号领域一致 · sourceUrl 真实或可空 · 按热度排序
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-full border border-border-muted bg-surface px-3 py-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${gatewayReady ? 'bg-green-500' : connectAttempted ? 'bg-amber-500' : 'bg-text-tertiary/40'}`}
                />
                <span className="text-[12px] font-bold text-text-secondary">
                  {gatewayReady ? '网关已连接' : connectAttempted ? '网关未就绪' : '连接中…'} · 上次抓取：
                  {fetchedLabel || (fetchedAt ? '刚刚' : '—')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void fetchHot()}
                disabled={!canFetch}
                className="rounded-lg border border-border-muted bg-surface px-3 py-2 text-[12px] font-extrabold text-text-secondary hover:bg-canvas hover:border-text-main/15 disabled:opacity-50 disabled:hover:bg-surface transition-colors"
              >
                {sending ? '抓取中…' : '🔄 立即抓取'}
              </button>
            </div>
          </div>

          <div className="mb-4">
            <FilterBar
              categories={categories}
              activeCategory={activeCategory}
              onChangeCategory={setActiveCategory}
              sortKey={sortKey}
              onChangeSort={setSortKey}
            />
          </div>

          <div className="space-y-3">
            {visible.map((t, i) => (
              <HotCard
                key={t.id}
                topic={t}
                index={i}
                onDismiss={(id) => setDismissedIds((prev) => new Set([...prev, id]))}
              />
            ))}

            {visible.length === 0 ? (
              <div className="text-center rounded-2xl border border-border-muted bg-surface p-8 text-text-secondary">
                {!connectAttempted ? (
                  '正在连接网关…'
                ) : !gatewayReady ? (
                  <div className="space-y-3">
                    <p className="text-[13px] leading-relaxed">
                      无法连接 OpenClaw Gateway（ws://127.0.0.1:18789）。请在本机启动网关进程；前端须由 Vite 提供，才能通过{' '}
                      <code className="rounded bg-canvas px-1 py-0.5 text-[12px]">/__openclaw_device_auth</code>{' '}
                      与{' '}
                      <code className="rounded bg-canvas px-1 py-0.5 text-[12px]">/__openclaw_device_identity</code>{' '}
                      读取本机 OpenClaw token（勿直接双击打开 dist HTML）。
                    </p>
                    {deviceAuthOk === false ? (
                      <p className="text-[13px] leading-relaxed text-amber-700/90 dark:text-amber-400/90">
                        当前页面无法访问上述接口（多为未走 Vite）。请在本项目目录执行{' '}
                        <code className="rounded bg-canvas px-1 py-0.5 text-[12px]">npm run dev</code> 或{' '}
                        <code className="rounded bg-canvas px-1 py-0.5 text-[12px]">npm run preview</code>，用浏览器打开终端里提示的本地地址。
                      </p>
                    ) : deviceAuthOk === true ? (
                      <p className="text-[13px] leading-relaxed">
                        本机 token 接口已可用，但 WebSocket 仍未就绪。请确认网关监听 18789、防火墙未拦截，并查看浏览器控制台中的{' '}
                        <code className="rounded bg-canvas px-1 py-0.5 text-[12px]">openclawClient</code> 日志。
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => handleReconnectGateway()}
                      className="rounded-lg border border-border-muted bg-canvas px-4 py-2 text-[12px] font-extrabold text-text-main hover:border-text-main/20 transition-colors"
                    >
                      重新连接网关
                    </button>
                  </div>
                ) : sending ? (
                  '正在抓取热点…'
                ) : fetchError ? (
                  fetchError
                ) : signals.length === 0 ? (
                  '还没有热点结果。'
                ) : (
                  '没有符合筛选条件的热点（或已全部点过「不感兴趣」）。'
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

