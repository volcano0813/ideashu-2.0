import type { HotTopic } from '../../types/hotspot'

export default function SourceChip({
  source,
}: {
  source: HotTopic['source']['relatedSources'][number]
}) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border border-border-muted bg-white/70 px-2.5 py-1 text-[12px] font-semibold text-text-secondary hover:bg-canvas hover:border-text-main/15 transition-colors whitespace-nowrap"
      onClick={(e) => e.stopPropagation()}
      title={source.title}
    >
      <span className="text-[13px]">{source.icon}</span>
      <span>{source.platform}</span>
      <span className="text-[11px] text-text-tertiary">↗</span>
    </a>
  )
}

