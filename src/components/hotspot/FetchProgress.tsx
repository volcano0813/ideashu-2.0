const STEP_LABELS = [
  '正在搜索小红书…',
  '正在搜索抖音…',
  '正在搜索微博…',
  '去重 + 评分中…',
] as const

export default function FetchProgress({ stepIndex }: { stepIndex: number }) {
  const idx = Math.max(0, Math.min(STEP_LABELS.length - 1, stepIndex))
  const pct = ((idx + 1) / STEP_LABELS.length) * 100

  return (
    <div className="rounded-xl border border-border-muted bg-surface p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] font-bold text-text-secondary">{STEP_LABELS[idx]}</div>
        <div className="text-[12px] font-extrabold tabular-nums text-text-tertiary">
          {Math.round(pct)}%
        </div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

