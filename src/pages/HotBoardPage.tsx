import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { WorkspaceLocationState } from '../lib/workspaceLocationState'

type Lifecycle = 'emerging' | 'hot' | 'peak' | 'declining'

type TrendSignal = {
  id: string
  keyword: string
  title: string
  heatScore: number
  lifecycle: Lifecycle
  suggestedAngles: string[]
  sources: { platform: string; url?: string; metrics?: string }[]
}

function lifecycleColor(l: Lifecycle) {
  switch (l) {
    case 'emerging':
      return '#3b82f6'
    case 'hot':
      return '#f97316'
    case 'peak':
      return '#ff2442'
    case 'declining':
      return '#6b7280'
  }
}

const MOCK_SIGNALS: TrendSignal[] = [
  {
    id: 's1',
    keyword: '咖啡第二杯',
    title: '“第二杯”话题：用更轻的口感讲出新体验',
    heatScore: 92,
    lifecycle: 'peak',
    suggestedAngles: ['第二杯的变化', '更轻的口感', '适合谁'],
    sources: [{ platform: '小红书', metrics: '高互动' }],
  },
  {
    id: 's2',
    keyword: '手冲参数',
    title: '把手冲参数写成故事：从温度到香气停顿',
    heatScore: 81,
    lifecycle: 'hot',
    suggestedAngles: ['温度表述', '香气停顿', '可复来建议'],
    sources: [{ platform: '微博', metrics: '讨论增长' }],
  },
  {
    id: 's3',
    keyword: '甜品搭配',
    title: '甜品搭配的“口感闭环”：一口让酸度更柔和',
    heatScore: 66,
    lifecycle: 'hot',
    suggestedAngles: ['搭配逻辑', '甜度不压咖啡', '结尾总结'],
    sources: [{ platform: '抖音', metrics: '收藏上升' }],
  },
  {
    id: 's4',
    keyword: '氛围感坐标',
    title: '把店内氛围写成坐标：暖光、木纹、停留时间',
    heatScore: 58,
    lifecycle: 'emerging',
    suggestedAngles: ['空间细节', '停留时间', '拍照机位'],
    sources: [{ platform: 'B站', metrics: '播放提升' }],
  },
  {
    id: 's5',
    keyword: '复购清单',
    title: '复购清单写法：值得再来的理由用 3 个指标',
    heatScore: 51,
    lifecycle: 'emerging',
    suggestedAngles: ['可复来指标', '价格与稳定性', '建议收藏'],
    sources: [{ platform: '知乎', metrics: '问答热度' }],
  },
  {
    id: 's6',
    keyword: '周边竞品对比',
    title: '竞品对比别写“谁更好”，写“你更适合哪种口感”',
    heatScore: 44,
    lifecycle: 'declining',
    suggestedAngles: ['适配人群', '口感差异', '最终建议'],
    sources: [{ platform: '微信', metrics: '转发下降' }],
  },
]

function uidNonce() {
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID?.() ?? `n_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

/** 发到对话里，由 Skill 先问答再出稿；不预填右侧编辑器 */
function messageFromSignal(sig: TrendSignal): string {
  return [
    `我想用「${sig.keyword}」方向写一篇更像真实笔记的内容：${sig.title}`,
    `我最近在看关于「${sig.keyword}」的内容，发现互动高的原因并不只是“热度”，而是大家在读的时候能代入到自己的场景。`,
    `我准备从三个角度切入：\n- ${sig.suggestedAngles[0]}\n- ${sig.suggestedAngles[1]}\n- ${sig.suggestedAngles[2]}`,
    '请先问我 3 个最关键的素材问题，再进入 ideashu-v5 的写作流程。',
  ].join('\n\n')
}

export default function HotBoardPage() {
  const navigate = useNavigate()
  const [minHeat, setMinHeat] = useState(40)
  const [lifecycle, setLifecycle] = useState<Lifecycle | 'all'>('all')
  const [source, setSource] = useState<'all' | string>('all')

  const signals = useMemo(() => {
    return MOCK_SIGNALS.filter((s) => {
      if (s.heatScore < minHeat) return false
      if (lifecycle !== 'all' && s.lifecycle !== lifecycle) return false
      if (source !== 'all') {
        const platforms = s.sources.map((x) => x.platform)
        if (!platforms.includes(source)) return false
      }
      return true
    }).sort((a, b) => b.heatScore - a.heatScore)
  }, [minHeat, lifecycle, source])

  return (
    <div className="p-8 overflow-hidden bg-canvas min-h-full font-sans">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold">热点看板</h1>
          <div className="text-sm text-text-secondary mt-1">mock 数据渲染（Phase 2 之后替换为真实 agent/websocket）</div>
        </div>
        <div className="text-xs font-bold text-text-secondary whitespace-nowrap">
          每 2 小时刷新：当前为 mock
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 h-[calc(100svh-10rem)]">
        <div className="flex flex-col overflow-hidden">
          <div className="bg-surface border border-border-muted rounded-2xl p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="text-xs font-bold text-text-secondary whitespace-nowrap">最低热度</div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={minHeat}
                  onChange={(e) => setMinHeat(Number(e.target.value))}
                />
                <div className="text-xs font-bold text-text-secondary w-12 text-right">{minHeat}</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs font-bold text-text-secondary whitespace-nowrap">生命周期</div>
                <select
                  value={lifecycle}
                  onChange={(e) => setLifecycle(e.target.value as Lifecycle | 'all')}
                  className="px-3 py-2 rounded-lg border border-border-muted bg-white text-sm"
                >
                  <option value="all">全部</option>
                  <option value="emerging">emerging</option>
                  <option value="hot">hot</option>
                  <option value="peak">peak</option>
                  <option value="declining">declining</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs font-bold text-text-secondary whitespace-nowrap">平台来源</div>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-border-muted bg-white text-sm"
                >
                  <option value="all">全部</option>
                  <option value="小红书">小红书</option>
                  <option value="微博">微博</option>
                  <option value="抖音">抖音</option>
                  <option value="知乎">知乎</option>
                  <option value="微信">微信</option>
                  <option value="B站">B站</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 mt-4">
            <div className="space-y-4">
              {signals.map((sig) => (
                <div key={sig.id} className="bg-surface border border-border-muted rounded-2xl p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="px-2 py-1 rounded-full text-[11px] font-bold"
                          style={{ backgroundColor: `${lifecycleColor(sig.lifecycle)}22`, color: lifecycleColor(sig.lifecycle) }}
                        >
                          {sig.lifecycle}
                        </span>
                        <span className="text-xs font-bold text-text-secondary">
                          {sig.keyword}
                        </span>
                      </div>
                      <div className="text-lg font-black mt-2 truncate text-text-main">
                        {sig.title}
                      </div>
                      <div className="text-sm text-text-secondary mt-2">
                        热度评分：<span className="font-black text-text-main">{sig.heatScore}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {sig.suggestedAngles.slice(0, 3).map((a) => (
                          <span key={a} className="px-2 py-1 rounded-full border border-border-muted bg-canvas/80 text-[11px] font-semibold text-text-secondary">
                            {a}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <div className="text-[12px] font-bold text-text-secondary whitespace-nowrap">
                        sources: {sig.sources[0]?.platform ?? '-'}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const state: WorkspaceLocationState = {
                            autoMessage: messageFromSignal(sig),
                            nonce: uidNonce(),
                          }
                          navigate('/workspace', { state })
                        }}
                        className="px-4 py-2 rounded-lg bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors"
                      >
                        用这个写
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          // placeholder
                        }}
                        className="px-4 py-2 rounded-lg border border-border-muted text-text-secondary font-semibold text-sm hover:border-text-main/20 hover:text-text-main transition-colors"
                      >
                        不感兴趣
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {signals.length === 0 && (
                <div className="text-sm text-text-secondary bg-surface border border-border-muted rounded-2xl p-6 text-center">
                  没有匹配的热点
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col overflow-hidden">
          <div className="bg-surface border border-border-muted rounded-2xl p-5 h-full overflow-hidden">
            <div className="font-bold text-text-main">内容节点日历</div>
            <div className="text-sm text-text-secondary mt-1">mock（月视图占位）</div>
            <div className="mt-4 h-[220px] rounded-xl border border-border-muted bg-canvas/60 flex items-center justify-center text-sm text-text-secondary">
              calendar placeholder
            </div>
            <div className="mt-5 font-bold text-text-main">竞品动态（侧边栏下方）</div>
            <div className="text-sm text-text-secondary mt-1">mock 紧凑卡片占位</div>
            <div className="mt-3 space-y-3 overflow-y-auto pr-1" style={{ maxHeight: 'calc(100% - 250px)' }}>
              {['博主A', '博主B', '博主C'].map((name) => (
                <div key={name} className="border border-border-muted rounded-xl p-3 bg-canvas/50">
                  <div className="text-sm font-black text-text-main">{name}</div>
                  <div className="text-xs text-text-secondary mt-1">近期：#{name}-话题</div>
                  <button className="mt-2 text-xs font-bold text-primary hover:underline" type="button">
                    借鉴这个方向
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

