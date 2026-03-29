import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { HotTopic } from '../../types/hotspot'
import HeatBar from './HeatBar'
import SourceChip from './SourceChip'
import type { WorkspaceLocationState } from '../../lib/workspaceLocationState'
import { useActiveAccount } from '../../contexts/ActiveAccountContext'

function uidNonce() {
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID?.() ?? `n_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function hostOrOpenLabel(url: string, domain?: string): string {
  if (domain && domain.trim().length > 0) return domain.trim()
  try {
    return new URL(url).hostname
  } catch {
    return '打开原文'
  }
}

function formatPublishedLine(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })
}

function trendBadge(trend: HotTopic['heat']['trend']) {
  switch (trend) {
    case 'exploding':
      return { label: '爆发', icon: '🔥', bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-100' }
    case 'rising':
      return { label: '上升', icon: '📈', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-100' }
    case 'declining':
      return { label: '回落', icon: '📉', bg: 'bg-gray-50', text: 'text-gray-500', border: 'border-gray-100' }
    default:
      return { label: '稳定', icon: '〰️', bg: 'bg-gray-50', text: 'text-gray-500', border: 'border-gray-100' }
  }
}

/** 发到对话里，由 Skill 先问答再出稿；不预填右侧编辑器 */
function messageFromHotTopic(t: HotTopic, accountName: string): string {
  const lines: string[] = []
  lines.push(`我想用这个热点做一篇更像真实体验的笔记：${t.title}`)
  lines.push(`来源：${t.source.type}（${t.source.primarySource.platform}）`)
  if (t.source.primarySource.url) lines.push(`原始链接：${t.source.primarySource.url}`)
  if (t.tags.cutIn && t.tags.cutIn !== '—') lines.push(`切入：${t.tags.cutIn}`)
  if (t.tags.hook && t.tags.hook !== '—') lines.push(`钩子：${t.tags.hook}`)
  if (t.tags.window && t.tags.window !== '—') lines.push(`窗口：${t.tags.window}`)
  if (t.materialMatch) lines.push(`素材匹配：有（${t.materialCount} 条）`)
  lines.push('')
  lines.push('请先问我 3 个最关键的素材问题，再进入 ideashu-v5 的写作流程。')
  lines.push(`账号：${accountName}`)
  return lines.join('\n')
}

export default function HotCard({
  topic,
  index,
  onDismiss,
}: {
  topic: HotTopic
  index: number
  onDismiss: (id: string) => void
}) {
  const navigate = useNavigate()
  const { activeAccount } = useActiveAccount()
  const trend = useMemo(() => trendBadge(topic.heat.trend), [topic.heat.trend])
  const primaryUrl = topic.source.primarySource.url?.trim() || ''
  const publishedAt = topic.source.primarySource.publishedAt?.trim()
  const sourcePlatform = topic.source.primarySource.platform || topic.source.type || ''

  return (
    <div
      className="group relative bg-white rounded-2xl border border-stone-200/60 transition-all duration-300 hover:border-stone-300 hover:shadow-[0_8px_30px_rgba(120,113,108,0.08)]"
      style={{
        animationDelay: `${index * 50}ms`,
        animationFillMode: 'both',
      }}
    >
      {/* 顶部色条 */}
      <div
        className="h-1 rounded-t-2xl"
        style={{
          background: topic.heat.score >= 75
            ? 'linear-gradient(90deg, #ef4444 0%, #f97316 100%)'
            : topic.heat.score >= 65
              ? 'linear-gradient(90deg, #f97316 0%, #fbbf24 100%)'
              : 'linear-gradient(90deg, #a8a29e 0%, #d6d3d1 100%)',
        }}
      />

      <div className="px-5 py-4">
        {/* 第一行：标签 + 热度 */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            {topic.materialMatch ? (
              <span className="inline-flex items-center gap-1 shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-100">
                ✅ {topic.materialCount} 条素材
              </span>
            ) : null}
            {sourcePlatform ? (
              <span className="inline-flex items-center shrink-0 rounded-full bg-stone-50 px-2.5 py-1 text-[11px] font-semibold text-stone-500 border border-stone-100">
                {sourcePlatform}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold border ${trend.bg} ${trend.text} ${trend.border}`}>
              {trend.icon} {trend.label}
            </span>
            <HeatBar value={topic.heat.score} />
          </div>
        </div>

        {/* 标题 */}
        <h3 className="text-[16px] font-extrabold text-stone-800 leading-relaxed tracking-tight">
          {topic.title}
        </h3>

        {/* 来源链接 / 无链接提示 */}
        <div className="mt-2 text-[12px]">
          {primaryUrl ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <a
                href={primaryUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-stone-600 hover:text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-stone-500 transition-colors"
                title={primaryUrl}
                onClick={(e) => e.stopPropagation()}
              >
                {hostOrOpenLabel(primaryUrl, topic.source.primarySource.domain)}
                <span className="text-[10px]">↗</span>
              </a>
              {publishedAt ? (
                <span className="text-stone-400">· {formatPublishedLine(publishedAt)}</span>
              ) : null}
            </div>
          ) : (
            <span className="text-stone-400">基于多源检索聚合，暂无直链</span>
          )}
        </div>

        {topic.source.relatedSources.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {topic.source.relatedSources.slice(0, 3).map((s) => (
              <SourceChip key={`${s.platform}:${s.url}`} source={s} />
            ))}
          </div>
        ) : null}

        {/* 切入角度 + 钩子 */}
        <div className="mt-3.5 flex flex-wrap gap-2">
          {topic.tags.cutIn && topic.tags.cutIn !== '—' ? (
            <div className="flex-1 min-w-[200px] rounded-xl bg-stone-50/80 border border-stone-100 px-3.5 py-2.5">
              <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">切入角度</div>
              <div className="text-[12px] font-medium text-stone-600 leading-relaxed">{topic.tags.cutIn}</div>
            </div>
          ) : null}
          {topic.tags.hook && topic.tags.hook !== '—' ? (
            <div className="shrink-0 rounded-xl bg-stone-50/80 border border-stone-100 px-3.5 py-2.5">
              <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1">钩子</div>
              <div className="text-[12px] font-semibold text-stone-600">{topic.tags.hook}</div>
            </div>
          ) : null}
        </div>

        {/* 操作按钮 */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onDismiss(topic.id)}
            className="px-3.5 py-1.5 rounded-lg text-[12px] font-semibold text-stone-400 hover:text-stone-600 hover:bg-stone-50 transition-colors"
          >
            不感兴趣
          </button>
          <button
            type="button"
            onClick={() => {
              const state: WorkspaceLocationState = {
                autoMessage: messageFromHotTopic(topic, activeAccount.name),
                nonce: uidNonce(),
              }
              navigate('/workspace', { state })
            }}
            className="px-4 py-2 rounded-xl bg-stone-800 text-white font-bold text-[12px] hover:bg-stone-700 active:scale-[0.98] transition-all shadow-sm"
          >
            用这个写 →
          </button>
        </div>
      </div>
    </div>
  )
}
