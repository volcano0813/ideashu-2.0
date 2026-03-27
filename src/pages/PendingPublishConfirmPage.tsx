import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { persistableImageUrl } from '../lib/imageCompress'
import {
  addStyleSampleFromPost,
  consumePendingPublish,
  savePost,
  uidForPost,
  type PendingPublish,
} from '../lib/ideashuStorage'

function formatPreview(text: string) {
  const t = text.trim()
  if (!t) return '（无正文）'
  return t.length > 500 ? `${t.slice(0, 500)}...` : t
}

export default function PendingPublishConfirmPage() {
  const navigate = useNavigate()
  const [pending] = useState<PendingPublish | null>(() => consumePendingPublish())
  const [saving, setSaving] = useState(false)

  const previewBody = useMemo(() => (pending ? formatPreview(pending.draft.body) : ''), [pending])

  if (!pending) {
    return (
      <div className="p-8 overflow-hidden bg-canvas min-h-full font-sans">
        <h1 className="text-2xl font-bold text-text-main">作品集确认</h1>
        <div className="mt-3 text-sm text-text-secondary">没有找到待发布的草稿，请回到编辑器重新保存。</div>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => navigate('/workspace')}
            className="px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 transition-colors"
          >
            返回编辑器
          </button>
        </div>
      </div>
    )
  }

  const pendingNN = pending

  const coverUrl = pendingNN.draft.cover.imageUrl

  async function confirmSave() {
    if (saving) return
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const id = pendingNN.id || uidForPost()
      const storedImageUrl = await persistableImageUrl(pendingNN.draft.cover.imageUrl)
      const post = {
        id,
        status: pendingNN.status,
        title: pendingNN.draft.title,
        body: pendingNN.draft.body,
        tags: pendingNN.draft.tags,
        cover: { ...pendingNN.draft.cover, imageUrl: storedImageUrl },
        originalDraft: pendingNN.originalDraft,
        editHistory: pendingNN.editHistory,
        createdAt: pendingNN.createdAt || now,
        updatedAt: now,
      }

      savePost(post)
      addStyleSampleFromPost(post)
      navigate('/knowledge-base')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 overflow-hidden bg-canvas min-h-full font-sans">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-text-main">作品集确认</h1>
          <div className="text-sm text-text-secondary mt-1">确认后写入作品集，并加入风格样本。</div>
        </div>
        <div className="text-xs font-bold text-text-secondary">status: {pending.status}</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,1fr)_420px] gap-6">
        <div className="bg-surface border border-border-muted rounded-2xl p-5 overflow-hidden">
          <div className="flex gap-4">
            <div className="w-[120px] h-[160px] rounded-xl border border-border-muted bg-[#f2f2f2] overflow-hidden flex-shrink-0">
              {typeof coverUrl === 'string' ? (
                <img src={coverUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs font-semibold text-text-secondary/80">
                  封面占位
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-text-secondary">标题</div>
              <div className="text-lg font-black text-text-main mt-1 line-clamp-2">{pendingNN.draft.title}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {pendingNN.draft.tags.slice(0, 6).map((t) => (
                  <span
                    key={t}
                    className="px-2 py-1 rounded-full border border-border-muted bg-canvas/80 text-[11px] font-semibold text-text-secondary"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-sm font-bold text-text-secondary">正文预览</div>
            <div className="mt-2 text-sm text-text-secondary whitespace-pre-wrap leading-snug">
              {previewBody}
            </div>
          </div>
        </div>

        <div className="bg-surface border border-border-muted rounded-2xl p-5 h-fit">
          <div className="text-sm font-bold text-text-main">确认动作</div>
          <div className="mt-2 text-sm text-text-secondary leading-relaxed">
            1. 保存到作品集（localStorage）
            <br />
            2. 若封面包含图片，将把该条转为风格样本
            <br />
            3. 跳转到作品集列表
          </div>

          <div className="mt-4 flex gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => navigate('/workspace')}
              className="px-4 py-2 rounded-lg border border-border-muted text-text-secondary font-semibold hover:border-primary/40 hover:text-primary transition-colors"
            >
              返回编辑器
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void confirmSave()}
              className="px-4 py-2 rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {saving ? '保存中…' : '确认保存到作品集'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

