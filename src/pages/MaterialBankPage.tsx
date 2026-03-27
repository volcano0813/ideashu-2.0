import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fileToCompressedDataUrl } from '../lib/imageCompress'
import { addMaterial, deleteMaterial, loadMaterials, updateMaterial, type Material } from '../lib/ideashuStorage'
import type { WorkspaceLocationState } from '../lib/workspaceLocationState'

function formatMaterialDate(createdAt: string): string {
  const parts = createdAt.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return createdAt
  const [, month, day] = parts
  return `${month}月${day}日`
}

const cardTints = [
  { bg: '#FFF8F0', accent: '#E8A87C' },
  { bg: '#F0F7FF', accent: '#7EB8E0' },
  { bg: '#FFF0F3', accent: '#E88FA3' },
  { bg: '#F2FFF0', accent: '#7EC88A' },
  { bg: '#F5F0FF', accent: '#A78BDB' },
  { bg: '#FFFBF0', accent: '#D4B85C' },
]

/** Soft fill from accent hex, matches tag + CTA treatment per card tint */
function accentSoftFill(hex: string, alpha = 0.14) {
  const s = hex.replace('#', '')
  if (s.length !== 6) return `rgba(0,0,0,${alpha})`
  const r = parseInt(s.slice(0, 2), 16)
  const g = parseInt(s.slice(2, 4), 16)
  const b = parseInt(s.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function hashString(input: string) {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0
  }
  return h
}

function InspirationCard({
  item,
  onCreate,
  onEdit,
  onDelete,
}: {
  item: Material
  onCreate: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const seed = item.topicTags[0] ?? item.id
  const tintFromIndex =
    item.tintIndex !== undefined && Number.isFinite(item.tintIndex)
      ? cardTints[Math.max(0, item.tintIndex) % cardTints.length]
      : null
  const tint = tintFromIndex ?? cardTints[Math.abs(hashString(seed)) % cardTints.length]

  return (
    <div
      className="group relative break-inside-avoid overflow-hidden rounded-[14px] border border-border-muted bg-surface transition-[transform,box-shadow] duration-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] group-hover:-translate-y-[2px]"
      style={{ background: tint.bg }}
    >
      <div aria-hidden className="absolute left-0 top-0 bottom-0 w-[4px]" style={{ background: tint.accent }} />

      {item.imageDataUrl ? (
        <div className="relative">
          <img
            src={item.imageDataUrl}
            alt=""
            className="block w-full object-cover transition-[filter] duration-300 group-hover:brightness-[1.02]"
          />
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[40px] bg-gradient-to-t from-white/80 to-transparent" />
        </div>
      ) : null}

      <div className="px-[18px] pt-[16px] pb-[12px]">
        <div className="mb-3 whitespace-pre-wrap text-[13.5px] leading-[1.8] tracking-[0.2px] text-text-main">
          {item.content}
        </div>

        {item.topicTags.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-[6px]">
            {item.topicTags.map((t) => (
              <span
                key={t}
                className="rounded-full px-[10px] py-[3px] text-[11px] font-medium tracking-[0.3px]"
                style={{ background: tint.bg, color: tint.accent }}
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-border-muted px-[18px] pb-[12px] pt-[10px]">
        <span className="text-[11px] font-normal text-[#CCC]">{formatMaterialDate(item.createdAt)}</span>

        <div
          className="flex items-center gap-[8px]"
          style={{ ['--card-accent' as string]: tint.accent }}
        >
          <button
            type="button"
            onClick={onCreate}
            className="rounded-full px-[12px] py-[4px] text-[11px] font-medium tracking-[0.3px] transition-colors hover:opacity-90"
            style={{ background: accentSoftFill(tint.accent), color: tint.accent }}
          >
            基于此素材创作
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-full p-[4px] text-[#CCC] transition-colors hover:text-[var(--card-accent)]"
            aria-label="编辑"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-full p-[4px] text-[#CCC] transition-colors hover:text-[var(--card-accent)]"
            aria-label="删除"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function uidNonce() {
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID?.() ?? `n_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export default function MaterialBankPage() {
  const navigate = useNavigate()
  const [materials, setMaterials] = useState<Material[]>(() => loadMaterials())
  const [search, setSearch] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [formContent, setFormContent] = useState('')
  const [formImageDataUrl, setFormImageDataUrl] = useState<string | null>(null)

  function refresh() {
    setMaterials(loadMaterials())
  }

  function closeModal() {
    setIsModalOpen(false)
    setEditingId(null)
    setFormContent('')
    setFormImageDataUrl(null)
  }

  function openEditMaterial(m: Material) {
    setEditingId(m.id)
    setFormContent(m.content)
    setFormImageDataUrl(m.imageDataUrl ?? null)
    setIsModalOpen(true)
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return materials
    return materials.filter((m) => {
      const tagsJoined = m.topicTags.join(' ').toLowerCase()
      return m.content.toLowerCase().includes(term) || tagsJoined.includes(term)
    })
  }, [materials, search])

  function handleCreateFromMaterial(material: Material) {
    const state: WorkspaceLocationState = {
      autoMessage: `帮我改\n\n素材内容：\n${material.content}`,
      materialImage: material.imageDataUrl ?? null,
      sourceMaterialId: material.id,
      nonce: uidNonce(),
    }
    navigate('/workspace', { state })
  }

  function handleSave() {
    const text = formContent.trim()
    if (editingId) {
      if (formImageDataUrl) {
        updateMaterial(editingId, {
          type: 'photo',
          content: text || '图片素材',
          imageDataUrl: formImageDataUrl,
        })
      } else {
        if (!text) {
          alert('内容不能为空')
          return
        }
        updateMaterial(editingId, {
          type: 'text',
          content: text,
        })
      }
    } else if (formImageDataUrl) {
      addMaterial({
        type: 'photo',
        content: text || '图片素材',
        imageDataUrl: formImageDataUrl,
        topicTags: [],
      })
    } else {
      if (!text) {
        alert('内容不能为空')
        return
      }
      addMaterial({
        type: 'text',
        content: text,
        topicTags: [],
      })
    }
    closeModal()
    refresh()
  }

  const canSave = formImageDataUrl !== null || formContent.trim().length > 0

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas p-4 font-sans">
      <div className="mx-auto flex min-h-0 min-w-0 w-full max-w-[min(100%,1920px)] flex-1 flex-col overflow-hidden px-1 sm:px-2">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-[min(100%,240px)] border-0 border-b border-border-muted bg-transparent py-2 text-sm text-text-main outline-none transition-colors placeholder:text-text-tertiary focus:border-primary"
            placeholder="搜索灵感内容或标签…"
          />
          <button
            type="button"
            onClick={() => {
              setEditingId(null)
              setFormContent('')
              setFormImageDataUrl(null)
              setIsModalOpen(true)
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            新建灵感
          </button>
        </div>

        <div className="min-h-0 min-w-0 w-full flex-1 overflow-y-auto overflow-x-hidden pr-1">
          <div className="grid w-full min-w-0 items-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
            {filtered.map((m) => (
              <InspirationCard
                key={m.id}
                item={m}
                onCreate={() => handleCreateFromMaterial(m)}
                onEdit={() => openEditMaterial(m)}
                onDelete={() => {
                  if (!confirm('确认删除该素材？')) return
                  deleteMaterial(m.id)
                  refresh()
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 px-4 backdrop-blur-sm"
          onClick={closeModal}
          role="presentation"
        >
          <div
            className="w-full max-w-[460px] rounded-[20px] border border-border-muted bg-surface overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.1)]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? '编辑灵感' : '新建灵感'}
          >
            <div className="px-7 pt-8 pb-6">
              <textarea
                style={{ minHeight: 140, lineHeight: '1.85', letterSpacing: '0.2px' }}
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="记录一段体验、感受或灵感…"
                rows={6}
                className="w-full min-h-[160px] resize-y border-0 bg-transparent text-sm leading-relaxed text-text-main outline-none placeholder:text-text-tertiary"
                autoFocus
              />

              {formImageDataUrl ? (
                <div className="mt-3 overflow-hidden rounded-xl border border-border-muted">
                  <img src={formImageDataUrl} alt="" className="max-h-40 w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setFormImageDataUrl(null)}
                    className="w-full py-1.5 text-xs text-text-secondary hover:text-primary"
                  >
                    移除图片
                  </button>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border-muted pt-4">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary">
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      try {
                        setFormImageDataUrl(await fileToCompressedDataUrl(f))
                      } catch (err) {
                        alert(err instanceof Error ? err.message : '图片处理失败')
                      }
                      e.target.value = ''
                    }}
                  />
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <rect
                      x="3"
                      y="3"
                      width="18"
                      height="18"
                      rx="3"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                    <path
                      d="M3 16L8 11L13 16"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M14 14L17 11L21 15"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  添加图片
                </label>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!canSave}
                  className={`rounded-full px-8 py-2.5 text-sm font-medium transition-all ${
                    canSave
                      ? 'cursor-pointer bg-primary text-white hover:bg-primary/90 shadow-[0_2px_8px_rgba(255,36,66,0.2)]'
                      : 'cursor-default bg-[#E8E8E8] text-text-tertiary shadow-none'
                  }`}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
