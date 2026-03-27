import type { HotTopic } from '../../types/hotspot'

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export default function ExpandedSources({ topic }: { topic: HotTopic }) {
  const primary = topic.source.primarySource
  const related = topic.source.relatedSources

  if (!primary.url && related.length === 0) return null

  const primaryHost =
    primary.url && (primary.domain || safeHost(primary.url)).length > 0
      ? primary.domain || safeHost(primary.url)
      : ''

  return (
    <div className="mt-3 rounded-xl border border-black/5 bg-black/[0.02] p-4">
      <div className="mb-2 text-[11px] font-extrabold tracking-wide text-text-tertiary uppercase">
        信息溯源
      </div>

      {primary.url ? (
        <a
          href={primary.url}
          target="_blank"
          rel="noreferrer"
          className="mb-2 flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-text-main hover:bg-canvas transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="rounded bg-black px-1.5 py-0.5 text-[10px] font-extrabold text-white">
            {primaryHost || '来源'}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            {primary.title || primary.platform}
          </span>
          <span className="text-[12px] text-text-tertiary">↗</span>
        </a>
      ) : null}

      <div className="flex flex-col gap-1">
        {related.map((s) => (
          <a
            key={`${s.platform}:${s.url}`}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border border-black/5 bg-white px-3 py-2 text-text-secondary hover:bg-canvas hover:border-text-main/10 transition-colors"
            onClick={(e) => e.stopPropagation()}
            title={s.title}
          >
            <span className="w-5 text-center text-[14px]">{s.icon}</span>
            <span className="w-14 shrink-0 text-[12px] font-bold text-text-tertiary">{s.platform}</span>
            <span className="min-w-0 flex-1 truncate text-[12px]">{s.title}</span>
            <span className="text-[11px] text-text-tertiary">↗</span>
          </a>
        ))}
      </div>
    </div>
  )
}

