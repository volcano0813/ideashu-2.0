import { useState } from 'react'
import { loadStyleSamples } from '../lib/ideashuStorage'

export default function StyleLearningPage() {
  // Style samples are saved locally from "待发布库" posts.
  // Mock-learning UI is kept; gating is driven by the real count.
  const [samples, setSamples] = useState(() => loadStyleSamples())
  const [learning, setLearning] = useState(false)
  const [learnedAt, setLearnedAt] = useState<string | null>(null)

  const sampleCount = samples.length
  const canLearn = sampleCount >= 10

  function refresh() {
    setSamples(loadStyleSamples())
  }

  async function handleLearn() {
    if (!canLearn || learning) return
    setLearning(true)
    try {
      // Mock: future work could call gateway `json:style_rules`.
      await new Promise((r) => setTimeout(r, 800))
      setLearnedAt(new Date().toISOString())
      refresh()
    } finally {
      setLearning(false)
    }
  }

  return (
    <div className="p-8 overflow-hidden bg-canvas min-h-full font-sans">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold">风格学习</h1>
          <div className="text-sm text-text-secondary mt-1">
            基于本地「待发布库」保存的图文样本学习；达到 10 条后可开始学习。
          </div>
        </div>
        <div className="text-xs font-bold text-text-secondary">
          当前：样本 {sampleCount}/10
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div className="bg-surface border border-border-muted rounded-2xl p-6 overflow-hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="font-bold text-text-main">图文样本列表</div>
            <button
              type="button"
              onClick={refresh}
              className="px-3 py-2 rounded-lg border border-border-muted bg-white text-sm font-semibold text-text-secondary hover:border-primary/30 hover:text-primary transition-colors"
            >
              刷新
            </button>
          </div>
          {samples.length === 0 ? (
            <div className="mt-4 text-sm text-text-secondary">
              暂无样本。先在编辑器保存到待发布库，累计满 10 条再学习。
            </div>
          ) : (
            <div className="mt-4 space-y-3 overflow-y-auto pr-2" style={{ maxHeight: 'calc(100svh - 18rem)' }}>
              {samples.slice(0, 20).map((s) => (
                <div key={s.id} className="border border-border-muted rounded-xl bg-canvas/60 p-4">
                  <div className="flex items-start gap-3">
                    {typeof s.cover?.imageUrl === 'string' ? (
                      <img
                        src={s.cover.imageUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-lg object-cover border border-border-muted"
                      />
                    ) : (
                      <div className="h-12 w-12 shrink-0 rounded-lg bg-surface border border-border-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-text-secondary">{new Date(s.createdAt).toLocaleString()}</div>
                      <div className="text-sm font-black text-text-main mt-1 line-clamp-2">{s.title}</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {s.tags.slice(0, 3).map((t) => (
                          <span key={t} className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-surface border border-border-muted rounded-2xl p-6">
          <div className="font-bold text-text-main">学习入口</div>
          <div className="mt-2 text-sm text-text-secondary leading-relaxed">
            当样本数达到 10 条时，才允许开始风格对齐学习。
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={handleLearn}
              disabled={!canLearn || learning}
              className="w-full rounded-xl bg-primary text-white font-bold py-3 text-sm hover:bg-primary/90 disabled:opacity-50 disabled:hover:bg-primary"
            >
              {learning ? '学习中…' : canLearn ? '开始学习风格对齐' : `再保存 ${10 - sampleCount} 条样本`}
            </button>
            {learnedAt ? (
              <div className="mt-2 text-xs text-text-secondary">
                最近学习时间：{new Date(learnedAt).toLocaleString()}
              </div>
            ) : null}
          </div>

          <div className="mt-5">
            <div className="font-bold text-text-main">学习效果（占位）</div>
            <div className="mt-2 h-32 rounded-xl border border-border-muted bg-canvas/60 flex items-center justify-center text-sm text-text-secondary">
              风格规则推断/折线图（mock）
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

