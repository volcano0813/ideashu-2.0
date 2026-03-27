import type { TrendSignal } from '../../lib/openclawClient'
import type { HotTopic, HotTopicType, HotTrend } from '../../types/hotspot'

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000

/** 统一展示：热点资讯有效窗口为近 3 天（替换模型里常见的 3–7 天表述） */
function normalizeHotspotWindowLabel(detail: string | undefined): string {
  const d = (detail ?? '').trim()
  if (!d) return '热点窗口 3 天内'
  return d
    .replace(/\s*3\s*[-–~～]\s*7\s*天/g, '3 天内')
    .replace(/3\s*[-–]\s*7\s*天/g, '3 天内')
}

/** 列表层：仅保留「近 3 天内」可核对发布时间的选题（常青除外；无 publishedAt 时仍展示以免列表被清空） */
export function trendSignalInThreeDayWindow(sig: TrendSignal): boolean {
  if (sig.timing === 'evergreen') return true
  const iso = typeof sig.publishedAt === 'string' ? sig.publishedAt.trim() : ''
  if (!iso) return true
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return true
  const age = Date.now() - t
  if (age < 0) return true
  return age <= THREE_DAYS_MS
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function iconForPlatform(platform: string): string {
  const p = (platform || '').toLowerCase()
  if (p.includes('小红书') || p.includes('xhs')) return '📕'
  if (p.includes('抖音') || p.includes('douyin') || p.includes('tiktok')) return '🎵'
  if (p.includes('微博') || p.includes('weibo')) return '🔥'
  if (p.includes('twitter') || p.includes('x')) return '𝕏'
  if (p.includes('youtube')) return '▶'
  if (p.includes('hacker news') || p.includes('hn')) return '🟧'
  if (p.includes('知乎')) return '知'
  if (p.includes('微信') || p.includes('公众号')) return '💬'
  if (p.includes('即刻')) return '⚡'
  if (p.includes('b站') || p.includes('bilibili')) return '📺'
  return '🔗'
}

function trendFromLifecycle(l: TrendSignal['lifecycle']): HotTrend {
  switch (l) {
    case 'peak':
      return 'exploding'
    case 'hot':
      return 'rising'
    case 'emerging':
      return 'rising'
    case 'declining':
      return 'declining'
    default:
      return 'stable'
  }
}

function typeFromSignal(sig: TrendSignal): HotTopicType {
  if (sig.timing === 'evergreen') return '常青'
  if (sig.lifecycle === 'declining') return '趋势'
  return '热点'
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function firstUrl(s: TrendSignal): string | null {
  const top = typeof s.sourceUrl === 'string' ? s.sourceUrl.trim() : ''
  if (top) {
    try {
      const u = new URL(top)
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.href
    } catch {
      // ignore
    }
  }
  const url = s.sources?.find((x) => typeof x?.url === 'string' && x.url.trim().length > 0)?.url
  return url ? url.trim() : null
}

export function hotTopicFromTrendSignal(sig: TrendSignal, fetchedAtISO: string): HotTopic {
  const url = firstUrl(sig)
  const primaryPlatform = sig.sources?.[0]?.platform || sig.topicSource || '热点来源'
  const primaryTitle = sig.topicSource || sig.sources?.[0]?.metrics || sig.title

  const related = (sig.sources || [])
    .slice(0, 6)
    .filter((s) => typeof s.platform === 'string' && typeof s.url === 'string' && s.url.trim().length > 0)
    .filter((s) => !url || String(s.url).trim() !== url.trim())
    .map((s) => ({
      platform: s.platform,
      icon: iconForPlatform(s.platform),
      title: s.metrics || sig.title || s.platform,
      url: String(s.url),
    }))

  const heatScore = clamp(Number.isFinite(sig.heatScore) ? sig.heatScore : Number(sig.heatScore), 0, 100)

  const publishedAt =
    typeof sig.publishedAt === 'string' && sig.publishedAt.trim().length > 0 ? sig.publishedAt.trim() : undefined

  return {
    id: sig.id,
    title: sig.title || sig.keyword || '热点方向',
    type: typeFromSignal(sig),
    category: sig.keyword || 'all',
    source: {
      type: sig.topicSource || '社区讨论',
      primarySource: {
        platform: primaryPlatform,
        title: primaryTitle,
        ...(url ? { url, domain: safeDomain(url) } : {}),
        ...(publishedAt ? { publishedAt } : {}),
      },
      relatedSources: related,
    },
    heat: {
      score: heatScore,
      trend: trendFromLifecycle(sig.lifecycle),
    },
    tags: {
      cutIn: sig.angle || sig.suggestedAngles?.[0] || '—',
      hook: sig.hook || sig.suggestedAngles?.[1] || '—',
      window:
        sig.timing === 'evergreen'
          ? '长期可发'
          : normalizeHotspotWindowLabel(sig.timingDetail),
    },
    materialMatch: Boolean(sig.materialMatch),
    materialCount: sig.materialCount ?? 0,
    date: fetchedAtISO,
  }
}

