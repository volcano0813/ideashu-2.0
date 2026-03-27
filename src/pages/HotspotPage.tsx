import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ensureOpenClawConnected,
  invalidateOpenClawConnectPromise,
  openclaw,
} from '../lib/openclawSingleton'
import { parseTopicsFromAssistantRaw, type TrendSignal } from '../lib/openclawClient'
import FetchProgress from '../components/hotspot/FetchProgress'
import FilterBar, { type HotspotSortKey } from '../components/hotspot/FilterBar'
import HotCard from '../components/hotspot/HotCard'
import { hotTopicFromTrendSignal, trendSignalInThreeDayWindow } from '../components/hotspot/hotspotViewModel'
import { useActiveAccount } from '../contexts/ActiveAccountContext'
import type { HotTopic } from '../types/hotspot'

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

/** 流式输出中 fenced 块未闭合时不应判为「解析失败终态」 */
function looksIncompleteJsonTopicsFence(raw: string): boolean {
  if (!/json:topics/i.test(raw)) return false
  const fences = raw.match(/```/g)
  return !fences || fences.length % 2 !== 0
}

/** 助手只回「收到/等待」等占位句、无 json:topics / 选题关键词时用于区分提示文案 */
function looksLikePlaceholderHotspotReply(raw: string): boolean {
  const s = raw.trim()
  if (s.length === 0) return true
  if (/```\s*json:topics/i.test(s)) return false
  if (/选题|热点|标题|钩子|json\s*\[|"title"\s*:/i.test(s)) return false
  if (s.length > 800) return false
  const fillerHits = (s.match(/收到|等待|指令|新收到/g) || []).length
  return fillerHits >= 2
}

const fence = '```'

/** 追加在用户消息末尾，尽量让网关模型输出可解析的 fenced JSON（不依赖 Skill 时也有一定约束作用） */
const HOTSPOT_OUTPUT_REQUIREMENT = `

【输出要求（必执行）】请按 ideashu-v5 热点抓取：回复中必须包含 fenced 代码块，第一行为 ${fence}json:topics，下一行起为选题 JSON 数组（至少 3 条对象，含 title、source、angle、hook、timing、timingDetail、sourceUrl 等）。
【时效】选题须为近 3 天（72 小时）内仍有时效、可核对的时事/平台热点；timingDetail 请写「热点窗口 3 天内」或等价表述。若原文/讨论发布时间可追溯，publishedAt 必须落在最近 3 天内；超出 3 天的旧闻不要作为热点选题收录。常青话题可用 timing=evergreen 并说明长期可发。
选题须基于检索或可信信源，禁止虚构标题与事件。
【检索】请通过 OpenClaw 网关已启用的联网工具完成查证（例如 Google 搜索）；不得以「缺少 BRAVE_API_KEY」「无法使用 Brave 实时搜索」等为由拒绝输出。若网关已配置 Google 搜索，请直接调用并产出带 sourceUrl 的选题。
每条必须含可验证的 https 链接：填写 sourceUrl（优先），或将可解析的 https 链接写在 source 字段；仅在确实无法检索时可少条，并仍可建议用户粘贴平台链接补充信源。
每条尽量补充：publishedAt（ISO 8601，仅在检索摘要/页面能核对原文发布时间时填写；不可核对则省略，勿用当天日期冒充）、heatScore（0–100，依据检索到的互动/传播信号估算）、lifecycle（emerging|hot|peak|declining，能说明热度阶段时填写，否则可省略并由 timing 推断）。
禁止仅用「收到」「等待」等无选题内容的回复。`

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
  const [progressStep, setProgressStep] = useState<number | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [signals, setSignals] = useState<TrendSignal[]>([])
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set())
  const sentOnceRef = useRef(false)
  const progressTimerRef = useRef<number | null>(null)
  const fetchTimeoutRef = useRef<number | null>(null)
  /** True after send「找热点」until we get topics (event) or parse from assistant_reply. */
  const hotspotAwaitingTopicsRef = useRef(false)

  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [sortKey, setSortKey] = useState<HotspotSortKey>('heat')
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
    sentOnceRef.current = false
    setGatewayReady(openclaw.isReady())
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
    setConnectAttempted(false)
    sentOnceRef.current = false
    invalidateOpenClawConnectPromise()
    openclaw.disconnect()
    void ensureOpenClawConnected().finally(() => setConnectAttempted(true))
  }

  useEffect(() => {
    const unsub = openclaw.onEvent((evt) => {
      if (evt.type === 'topics') {
        hotspotAwaitingTopicsRef.current = false
        clearFetchTimeout()
        setFetchError(null)
        setSignals(evt.topics)
        setFetchedAt(new Date().toISOString())
        setSending(false)
        setProgressStep(null)
        if (progressTimerRef.current) {
          window.clearInterval(progressTimerRef.current)
          progressTimerRef.current = null
        }
        return
      }
      if (evt.type === 'assistant_reply' && hotspotAwaitingTopicsRef.current) {
        const parsed = parseTopicsFromAssistantRaw(evt.rawFull ?? evt.text)
        if (parsed && parsed.length > 0) {
          hotspotAwaitingTopicsRef.current = false
          clearFetchTimeout()
          setFetchError(null)
          setSignals(parsed)
          setFetchedAt(new Date().toISOString())
          setSending(false)
          setProgressStep(null)
          if (progressTimerRef.current) {
            window.clearInterval(progressTimerRef.current)
            progressTimerRef.current = null
          }
        } else {
          const raw = evt.rawFull ?? evt.text
          if (looksIncompleteJsonTopicsFence(raw)) {
            hotspotAwaitingTopicsRef.current = true
            return
          }
          hotspotAwaitingTopicsRef.current = false
          clearFetchTimeout()
          setSending(false)
          setProgressStep(null)
          if (progressTimerRef.current) {
            window.clearInterval(progressTimerRef.current)
            progressTimerRef.current = null
          }
          setFetchError(
            looksLikePlaceholderHotspotReply(raw)
              ? '助手只返回了占位话术（如「收到」「等待」），没有热点 JSON。请确认 ideashu-v5 Skill 生效，且每条 json:topics 含可追溯 https 链接（sourceUrl）。可点击「立即抓取」重试。'
              : '未能解析出选题：请确认回复中含 ```json:topics 代码块且为 JSON 数组。若助手只回了说明文字、或每条都被判为「系统限制」占位，请重试或让助手直接输出选题 JSON（即使暂未填 sourceUrl，也会先展示卡片）。',
          )
        }
      }
    })
    return () => unsub()
  }, [])

  const canFetch = gatewayReady && !sending

  function startProgress() {
    setProgressStep(0)
    if (progressTimerRef.current) window.clearInterval(progressTimerRef.current)
    progressTimerRef.current = window.setInterval(() => {
      setProgressStep((cur) => {
        if (cur == null) return 0
        return Math.min(cur + 1, 3)
      })
    }, 900)
  }

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
      setSending((cur) => {
        if (!cur) return cur
        setProgressStep(null)
        if (progressTimerRef.current) {
          window.clearInterval(progressTimerRef.current)
          progressTimerRef.current = null
        }
        setFetchError(
          '抓取超时：仍未得到可用于热点列表的选题。请确认助手返回 json:topics 且每条含新闻/平台类 sourceUrl（https）。若网关已配置 OpenClaw 的 Google 搜索，请确认助手调用了检索；否则可在对话中手动附上信源链接后再试。',
        )
        return false
      })
    }, 90_000)
    hotspotAwaitingTopicsRef.current = true
    setSending(true)
    startProgress()
    const dRaw = (activeAccount.domain ?? '').trim()
    const d = dRaw.replace(/^\s*(领域|domain)\s*[:：=]\s*/i, '')
    // Skill 触发词：以「找热点 + 关键词/领域」贴近 ideashu-v5；末尾追加硬性输出要求以提高 json:topics 产出率
    const parts = ['找热点']
    if (d && d !== '未设置') parts.push(d)
    openclaw.send(parts.join(' ') + HOTSPOT_OUTPUT_REQUIREMENT)
  }, [activeAccount.domain, activeAccountId])

  useEffect(() => {
    if (!gatewayReady) return
    if (sentOnceRef.current) return
    sentOnceRef.current = true
    // Defer to next tick to avoid cascading-render lint.
    window.setTimeout(() => fetchHot(), 0)
  }, [gatewayReady, fetchHot, activeAccountId])

  useEffect(() => {
    return () => {
      clearFetchTimeout()
      if (progressTimerRef.current) window.clearInterval(progressTimerRef.current)
    }
  }, [])

  const categories = useMemo(() => {
    const fromDomain = categoriesFromAccountDomain(activeAccount.domain)
    return [{ key: 'all', label: '全部' }, ...fromDomain]
  }, [activeAccount.domain])

  const signalsForUi = useMemo(() => signals.filter(trendSignalInThreeDayWindow), [signals])

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
      return new Date(b.date).getTime() - new Date(a.date).getTime()
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
                热点资讯窗口：近 3 天内 · 基于账号定位匹配 · 信源由网关侧检索 · 每条须可溯源
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

          {sending && progressStep != null ? (
            <div className="mb-4">
              <FetchProgress stepIndex={progressStep} />
            </div>
          ) : null}

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
                ) : signalsForUi.length === 0 ? (
                  '近 3 天窗口：当前抓取里没有发布时间在近 3 天内的热点。请重试抓取，或让助手按窗口补充 publishedAt。'
                ) : (
                  '没有符合筛选条件的热点。'
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

