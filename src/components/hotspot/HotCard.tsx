import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { HotTopic } from '../../types/hotspot'
import HeatBar from './HeatBar'
import SourceChip from './SourceChip'
import { setPendingDraft } from '../../lib/ideashuStorage'
import type { Draft } from '../XhsPostEditor'
import { useActiveAccount } from '../../contexts/ActiveAccountContext'

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
      return { label: '爆发', icon: '🔥', color: '#ef4444' }
    case 'rising':
      return { label: '上升', icon: '📈', color: '#f97316' }
    case 'declining':
      return { label: '下降', icon: '📉', color: '#6b7280' }
    default:
      return { label: '稳定', icon: '〰️', color: '#6b7280' }
  }
}

function draftFromHotTopic(t: HotTopic, accountName: string): Draft {
  const overlayText = (t.title || '').slice(0, 7)
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

  return {
    title: t.title,
    body: lines.join('\n'),
    tags: [t.title].filter(Boolean).slice(0, 1),
    cover: {
      type: 'photo',
      description: '',
      overlayText: overlayText || accountName,
      imageUrl: undefined,
    },
  }
}

function PrimaryLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
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
  const listUpdatedLine = topic.date ? formatPublishedLine(topic.date) : ''

  return (
    <div
      className="bg-surface border border-border-muted rounded-2xl p-5 transition-[box-shadow,border-color] duration-200 hover:shadow-[0_10px_30px_rgba(0,0,0,0.06)] hover:border-text-main/15"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {topic.materialMatch ? (
          <span className="rounded-md border border-green-500/25 bg-green-500/10 px-2 py-1 text-[11px] font-extrabold text-green-700">
            ✅ 有 {topic.materialCount} 条素材匹配
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-3">
          <span className="text-[12px] font-bold" style={{ color: trend.color }}>
            {trend.icon} {trend.label}
          </span>
          <HeatBar value={topic.heat.score} />
        </div>
      </div>

      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-black text-text-main leading-snug">{topic.title}</div>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            <span className="inline-flex shrink-0 text-text-tertiary" title="原始链接" aria-label="原始链接">
              <PrimaryLinkIcon className="h-4 w-4" />
            </span>
            {primaryUrl ? (
              <>
                <a
                  href={primaryUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 font-semibold text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary"
                  title={primaryUrl}
                  onClick={(e) => e.stopPropagation()}
                >
                  {hostOrOpenLabel(primaryUrl, topic.source.primarySource.domain)}
                  <span className="ml-1 text-[12px] opacity-70">↗</span>
                </a>
                <span className="shrink-0 text-[12px] font-medium text-text-tertiary">
                  {publishedAt ? (
                    <>· {formatPublishedLine(publishedAt)}</>
                  ) : (
                    <>
                      · 发布时间未提供
                      {listUpdatedLine ? (
                        <span className="text-text-tertiary/80" title="本列表拉取时间，非原文发布时间">
                          {' '}
                          · 列表更新 {listUpdatedLine}
                        </span>
                      ) : null}
                    </>
                  )}
                </span>
              </>
            ) : (
              <span className="text-[12px] font-medium text-text-tertiary">
                无。请让助手为该条补充 https 的 sourceUrl。
              </span>
            )}
          </div>

          {topic.source.relatedSources.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {topic.source.relatedSources.slice(0, 3).map((s) => (
                <SourceChip key={`${s.platform}:${s.url}`} source={s} />
              ))}
            </div>
          ) : null}
        </div>

        <div className="shrink-0 flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => {
              setPendingDraft(draftFromHotTopic(topic, activeAccount.name))
              navigate('/workspace')
            }}
            className="px-4 py-2 rounded-lg bg-text-main text-white font-extrabold text-[13px] hover:bg-black/80 transition-colors"
          >
            用这个写 →
          </button>
          <button
            type="button"
            onClick={() => onDismiss(topic.id)}
            className="px-4 py-2 rounded-lg border border-border-muted text-text-secondary font-bold text-[12px] hover:border-text-main/20 hover:text-text-main transition-colors"
          >
            不感兴趣
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <div className="flex items-center gap-2 rounded-lg bg-black/[0.02] border border-black/5 px-3 py-1.5 text-[12px]">
          <span className="font-bold text-text-tertiary">切入：</span>
          <span className="font-semibold text-text-secondary">{topic.tags.cutIn}</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-black/[0.02] border border-black/5 px-3 py-1.5 text-[12px]">
          <span className="font-bold text-text-tertiary">钩子：</span>
          <span className="font-semibold text-text-secondary">{topic.tags.hook}</span>
        </div>
      </div>
    </div>
  )
}
