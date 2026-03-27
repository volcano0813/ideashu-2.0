import { useMemo } from 'react'

function colorForHeat(v: number) {
  if (v >= 90) return '#ef4444'
  if (v >= 75) return '#f97316'
  if (v >= 60) return '#eab308'
  return '#6b7280'
}

export default function HeatBar({ value }: { value: number }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
  const color = useMemo(() => colorForHeat(v), [v])

  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-16 rounded-full bg-black/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${v}%`, background: color }}
        />
      </div>
      <span className="text-[11px] font-extrabold tabular-nums" style={{ color }}>
        {Math.round(v)}
      </span>
    </div>
  )
}

