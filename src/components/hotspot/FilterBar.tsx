export type HotspotSortKey = 'heat' | 'time'

export default function FilterBar({
  categories,
  activeCategory,
  onChangeCategory,
  sortKey,
  onChangeSort,
}: {
  categories: Array<{ key: string; label: string }>
  activeCategory: string
  onChangeCategory: (key: string) => void
  sortKey: HotspotSortKey
  onChangeSort: (key: HotspotSortKey) => void
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap">
        {categories.map((c) => {
          const active = c.key === activeCategory
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onChangeCategory(c.key)}
              className={
                active
                  ? 'px-4 py-1.5 rounded-lg bg-text-main text-white text-[13px] font-bold border border-text-main'
                  : 'px-4 py-1.5 rounded-lg bg-surface text-[13px] text-text-secondary border border-border-muted hover:border-text-main/15 hover:bg-canvas transition-colors'
              }
            >
              {c.label}
            </button>
          )
        })}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChangeSort(sortKey === 'heat' ? 'time' : 'heat')}
          className="px-3 py-1.5 rounded-lg bg-surface text-[12px] font-bold text-text-secondary border border-border-muted hover:border-text-main/15 hover:bg-canvas transition-colors whitespace-nowrap"
          title="切换排序：热度 / 时间"
        >
          {sortKey === 'heat' ? '按热度排序 ↓' : '按时间排序 ↓'}
        </button>
      </div>
    </div>
  )
}

