/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  saveDraftSession,
  setPendingPublish,
  uidForPost,
  type EditRecord,
} from '../lib/ideashuStorage'

export type EditorStage = 1 | 2 | 3 | 4
export type CoverType = 'photo' | 'text' | 'collage' | 'compare' | 'list'
export type Compliance = 'safe' | 'caution' | 'risk'

export type CoverData = {
  type: CoverType
  description: string
  overlayText: string
  imageUrl?: string // base64 for demo
}

export type Draft = {
  title: string
  body: string
  tags: string[]
  cover: CoverData
  /** Present when Skill emits stage-4 finalized payload via `json:draft`. */
  status?: 'finalized' | string
  /** ideashu-v5: `polish` | `write` */
  mode?: string
  structureType?: string
  materialAnchors?: string[]
}

export type OriginalityReport = {
  userMaterialPct: number
  aiAssistPct: number
  compliance: Compliance
  materialSources: string[]
}

export type QualityScore = {
  hook: number
  authentic: number
  aiSmell: number
  diversity: number
  cta: number
  platform: number
  suggestions: string[]
}

type Props = {
  stage?: EditorStage
  loadedDraft?: Draft
  originalDraft?: Draft
  originalityReport?: OriginalityReport
  qualityScore?: QualityScore
  onSaveToKB?: (post: Draft & { finalizedBody?: string }) => void
  // Used by the WS integration: WorkspacePage needs current editor text for Skill scoring.
  onDraftChange?: (draft: Draft) => void
  /** 发送 `继续` 给 agent（质检） */
  onSubmitQuality?: () => void
  gatewayDisconnected?: boolean
  /** Clear local draft session (used by WorkspacePage “重置草稿” button). */
  onResetDraftSession?: () => void
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function splitIntoParagraphs(text: string): string[] {
  const normalized = (text ?? '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return ['']
  return normalized.split(/\n\s*\n/g)
}

function splitIntoParagraphsForBodyEdit(text: string): string[] {
  // Body edit: avoid `.trim()` so IME intermediate states don't get destroyed.
  const normalized = (text ?? '').replace(/\r\n/g, '\n')
  if (!normalized) return ['']
  const parts = normalized.split(/\n\s*\n/g)
  // Avoid trailing empty paragraph from trailing newlines.
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop()
  return parts.length ? parts : ['']
}

function countChars(s: string) {
  return (s ?? '').length
}

function complianceFromUserPct(userMaterialPct: number): Compliance {
  if (userMaterialPct >= 60) return 'safe'
  if (userMaterialPct >= 45) return 'caution'
  return 'risk'
}

function complianceColor(c: Compliance) {
  switch (c) {
    case 'safe':
      return { ring: '#22c55e', badge: 'bg-green-50 text-green-700 border-green-200' }
    case 'caution':
      return { ring: '#eab308', badge: 'bg-amber-50 text-amber-700 border-amber-200' }
    case 'risk':
      return { ring: '#ef4444', badge: 'bg-red-50 text-red-700 border-red-200' }
  }
}

function formatPct(n: number) {
  return `${Math.round(clamp(n, 0, 100))}%`
}

function computeQualityFromEditCount(editCount: number): QualityScore {
  // Demo-only: higher edits => more risk (lower authentic, higher ai smell).
  const t = clamp(editCount, 0, 20)
  const hook = clamp(85 - t * 0.8, 0, 100)
  const authentic = clamp(85 - t * 1.6, 0, 100)
  const aiSmell = clamp(25 + t * 3.2, 0, 100)
  const diversity = clamp(72 - t * 0.9, 0, 100)
  const cta = clamp(78 - t * 0.6, 0, 100)
  const platform = clamp(80 - t * 0.7, 0, 100)

  const total = Math.round(
    (hook + authentic + aiSmell + diversity + cta + platform) / 6,
  )

  const suggestions: string[] = []
  if (authentic < 55) suggestions.push('补充你的真实细节与时间地点，让体验更具体。')
  if (aiSmell > 60) suggestions.push('降低“模板化表达”，替换为你自己的口吻与比喻。')
  if (hook < 60) suggestions.push('开头再强化一行“冲突/好奇点”，提高停留率。')
  if (suggestions.length === 0) suggestions.push('当前文本结构与语气比较稳定，继续小范围微调即可。')

  // The UI uses individual dims + optional total; we include total via platform-like fields elsewhere.
  void total
  return {
    hook,
    authentic,
    aiSmell,
    diversity,
    cta,
    platform,
    suggestions,
  }
}

function OriginalityRing({
  userMaterialPct,
  compliance,
  size = 44,
  onClick,
}: {
  userMaterialPct: number
  compliance: Compliance
  size?: number
  onClick?: () => void
}) {
  const { ring } = complianceColor(compliance)
  const stroke = 5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = clamp(userMaterialPct, 0, 100) / 100
  const dash = c * pct
  const rest = c - dash

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative inline-flex items-center justify-center"
      aria-label="Originality indicator"
    >
      <svg width={size} height={size} className="block">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#f0f0f0"
          strokeWidth={stroke}
          fill="transparent"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={ring}
          strokeWidth={stroke}
          fill="transparent"
          strokeDasharray={`${dash} ${rest}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-tight">
        <div className="text-[11px] font-bold" style={{ color: ring }}>
          {Math.round(userMaterialPct)}
        </div>
        <div className="text-[9px] font-bold text-text-secondary -mt-0.5">%</div>
      </div>
    </button>
  )
}

function barFillColor(value: number) {
  const v = clamp(value, 0, 100)
  if (v >= 80) return '#00C853'
  if (v >= 60) return '#FF9800'
  return '#ff2442'
}

function Bar({
  label,
  value,
}: {
  label: string
  value: number
}) {
  const v = clamp(value, 0, 100)
  const fill = barFillColor(v)
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-14 shrink-0 text-xs font-medium text-text-secondary text-right">{label}</span>
      <div className="flex-1 h-[5px] rounded-sm bg-[#F0F0F0] overflow-hidden">
        <div
          className="h-full rounded-sm transition-[width] duration-500"
          style={{ width: `${v}%`, backgroundColor: fill }}
        />
      </div>
      <span className="w-7 shrink-0 text-xs font-medium text-right tabular-nums" style={{ color: fill }}>
        {Math.round(v)}
      </span>
    </div>
  )
}

function AutoGrowParagraph({
  value,
  readOnly,
  modified,
  onChange,
  onCompositionStart,
  onCompositionEnd,
}: {
  value: string
  readOnly: boolean
  modified: boolean
  onChange: (next: string) => void
  onCompositionStart?: () => void
  onCompositionEnd?: () => void
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <div
      className={
        modified
          ? 'border-l-[3px] border-l-[#eab308] pl-2'
          : 'border-l-[3px] border-l-transparent pl-2'
      }
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onCompositionStart={() => onCompositionStart?.()}
        onCompositionEnd={() => onCompositionEnd?.()}
        readOnly={readOnly}
        className="w-full resize-none outline-none bg-transparent border-none p-0 text-[13px] leading-[1.55] text-text-main placeholder:text-text-secondary/70"
        rows={1}
      />
    </div>
  )
}

const COVER_OPTIONS: { type: CoverType; label: string }[] = [
  { type: 'photo', label: '实拍图' },
  { type: 'text', label: '文字封面' },
  { type: 'collage', label: '拼图' },
  { type: 'compare', label: '对比图' },
  { type: 'list', label: '清单图' },
]

export default function XhsPostEditor({
  stage = 1,
  loadedDraft,
  originalDraft,
  originalityReport,
  qualityScore,
  onSaveToKB: _onSaveToKB,
  onDraftChange,
  onSubmitQuality,
  gatewayDisconnected,
  onResetDraftSession,
}: Props) {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [cover, setCover] = useState<CoverData>({
    type: 'photo',
    description: '',
    overlayText: '',
    imageUrl: undefined,
  })

  const [paragraphs, setParagraphs] = useState<string[]>([''])
  const [originalParagraphs, setOriginalParagraphs] = useState<string[]>([])

  const [postId, setPostId] = useState<string | null>(null)
  const [editHistory, setEditHistory] = useState<EditRecord[]>([])
  const [sessionCreatedAt, setSessionCreatedAt] = useState<string>('')

  const editDebounceTimer = useRef<number | null>(null)
  const pendingEditRef = useRef<{
    location: EditRecord['location']
    original: string
    editType: EditRecord['editType']
  } | null>(null)

  // IME 中文输入期间：避免频繁写历史/重排导致卡顿与光标丢失。
  const isComposingRef = useRef(false)

  const stageRef = useRef(stage)

  const draftRef = useRef<Draft>({
    title: '',
    body: '',
    tags: [],
    cover: {
      type: 'photo',
      description: '',
      overlayText: '',
      imageUrl: undefined,
    },
  })

  const originalDraftRef = useRef<Draft | null>(null)
  const originalTitleRef = useRef('')
  const originalTagsRef = useRef<string[]>([])
  const originalBodyRef = useRef('')
  const originalCoverRef = useRef<CoverData>({
    type: 'photo',
    description: '',
    overlayText: '',
    imageUrl: undefined,
  })

  const [isOriginalityOpen, setIsOriginalityOpen] = useState(false)
  const [isQualityOpen, setIsQualityOpen] = useState(false)

  const hasDraft = stage >= 2 && !!loadedDraft
  const editCount = editHistory.length

  // Boot / 选题：无 Skill 草稿时保持编辑器空白，避免占位文案污染。
  useEffect(() => {
    if (stage !== 1) return
    if (loadedDraft) return
    if (editDebounceTimer.current) window.clearTimeout(editDebounceTimer.current)
    editDebounceTimer.current = null
    pendingEditRef.current = null
    setTitle('')
    setTags([])
    setTagInput('')
    setCover({ type: 'photo', description: '', overlayText: '', imageUrl: undefined })
    setParagraphs([''])
    setOriginalParagraphs([])
    setPostId(null)
    setEditHistory([])
    setSessionCreatedAt('')
    originalDraftRef.current = null
    originalTitleRef.current = ''
    originalTagsRef.current = []
    originalBodyRef.current = ''
    originalCoverRef.current = {
      type: 'photo',
      description: '',
      overlayText: '',
      imageUrl: undefined,
    }
    setIsOriginalityOpen(false)
    setIsQualityOpen(false)
  }, [stage, loadedDraft])

  // Load stage2 draft.
  useEffect(() => {
    if (stage !== 2) return
    if (!loadedDraft) return
    if (editDebounceTimer.current) window.clearTimeout(editDebounceTimer.current)
    editDebounceTimer.current = null
    pendingEditRef.current = null

    setTitle(loadedDraft.title)
    setTags(loadedDraft.tags)
    setTagInput('')
    setCover(loadedDraft.cover)
    setParagraphs(splitIntoParagraphs(loadedDraft.body))
    setOriginalParagraphs(splitIntoParagraphs(loadedDraft.body))
    const now = new Date().toISOString()
    const nextPostId = uidForPost()
    setPostId(nextPostId)
    setEditHistory([])
    setSessionCreatedAt(now)

    originalDraftRef.current = loadedDraft
    originalTitleRef.current = loadedDraft.title
    originalTagsRef.current = loadedDraft.tags
    originalBodyRef.current = loadedDraft.body
    originalCoverRef.current = loadedDraft.cover

    saveDraftSession({
      postId: nextPostId,
      stage: 2,
      originalDraft: loadedDraft,
      draft: loadedDraft,
      editHistory: [],
      createdAt: now,
      updatedAt: now,
    })
    setIsOriginalityOpen(false)
    setIsQualityOpen(false)
  }, [stage, loadedDraft])

  // If stage >= 3 and original draft is passed, use it for diff marking.
  useEffect(() => {
    if (stage < 3) return
    if (!originalDraft) return
    setOriginalParagraphs(splitIntoParagraphs(originalDraft.body))
  }, [stage, originalDraft])

  // Keep refs in sync for debounced persistence.
  useEffect(() => {
    stageRef.current = stage
  }, [stage])

  useEffect(() => {
    draftRef.current = {
      title,
      body: paragraphs.join('\n\n'),
      tags,
      cover,
    }
  }, [title, tags, paragraphs, cover])

  // WS integration helper: expose a debounced snapshot of the editor draft to the parent.
  useEffect(() => {
    if (!onDraftChange) return
    if (stage < 2) return

    const t = window.setTimeout(() => {
      onDraftChange({
        title,
        body: paragraphs.join('\n\n'),
        tags,
        cover,
      })
    }, 250)

    return () => window.clearTimeout(t)
  }, [onDraftChange, stage, title, paragraphs, tags, cover])

  // Quality panel default behavior at stage3.
  useEffect(() => {
    if (stage === 3) setIsQualityOpen(true)
  }, [stage])

  const originality = useMemo<OriginalityReport>(() => {
    // Use gateway report as a seed, but still let user edits move the ring.
    const modifiedCount = paragraphs.reduce((acc, p, idx) => {
      const o = originalParagraphs[idx] ?? ''
      return acc + (p.trim() !== o.trim() ? 1 : 0)
    }, 0)

    const seedUserMaterialPct = originalityReport
      ? originalityReport.userMaterialPct
      : clamp(70 - editCount * 3.2, 0, 100)

    const userMaterialPct = clamp(seedUserMaterialPct - editCount * 3.2 - modifiedCount * 0.9, 0, 100)
    const aiAssistPct = clamp(100 - userMaterialPct, 0, 100)
    const compliance = complianceFromUserPct(userMaterialPct)

    const sourcesSeed = originalityReport?.materialSources?.length ? originalityReport.materialSources : []
    const sourcesSet = new Set<string>(sourcesSeed)
    sourcesSet.add('用户直接输入')
    if (editCount >= 2 || modifiedCount >= 3) sourcesSet.add('素材银行 #3')
    else sourcesSet.add('素材银行 #1')

    return {
      userMaterialPct,
      aiAssistPct,
      compliance,
      materialSources: Array.from(sourcesSet),
    }
  }, [originalityReport, editCount, paragraphs, originalParagraphs])

  const computedQuality = useMemo<QualityScore>(() => {
    if (qualityScore) return qualityScore
    return computeQualityFromEditCount(editCount)
  }, [qualityScore, editCount])

  const qualityTotal = useMemo(() => {
    const dims = [
      computedQuality.hook,
      computedQuality.authentic,
      computedQuality.aiSmell,
      computedQuality.diversity,
      computedQuality.cta,
      computedQuality.platform,
    ]
    return Math.round(dims.reduce((a, b) => a + b, 0) / dims.length)
  }, [computedQuality])

  const modifiedParagraphs = useMemo(() => {
    const orig = originalParagraphs
    return paragraphs.map((p, idx) => {
      const o = orig[idx] ?? ''
      return p.trim() !== o.trim()
    })
  }, [paragraphs, originalParagraphs])

  const charCount = useMemo(() => countChars(title), [title])

  const wordCount = useMemo(() => {
    // Rough count: count non-space characters in body + title.
    const text = `${title}\n${paragraphs.join('\n')}`
    return text.replace(/\s/g, '').length
  }, [title, paragraphs])

  function commitEdit() {
    if (!postId) return
    if (isComposingRef.current) return
    const pending = pendingEditRef.current
    if (!pending) return
    pendingEditRef.current = null

    const now = new Date().toISOString()
    const record: EditRecord = {
      id: uidForPost(),
      postId,
      timestamp: now,
      location: pending.location,
      original: pending.original,
      modified: draftRef.current.body,
      editType: pending.editType,
    }

    setEditHistory((prev) => {
      const next = [...prev, record]
      const sessionOriginal = originalDraftRef.current
      if (sessionOriginal) {
        saveDraftSession({
          postId,
          stage: stageRef.current,
          originalDraft: sessionOriginal,
          draft: draftRef.current,
          editHistory: next,
          createdAt: sessionCreatedAt,
          updatedAt: now,
        })
      }
      return next
    })
  }

  function applyPendingEditNow(): EditRecord[] {
    if (!postId) return editHistory
    if (!pendingEditRef.current) return editHistory
    if (isComposingRef.current) return editHistory

    if (editDebounceTimer.current) window.clearTimeout(editDebounceTimer.current)
    editDebounceTimer.current = null

    const pending = pendingEditRef.current
    pendingEditRef.current = null

    const now = new Date().toISOString()
    const currentBody = paragraphs.join('\n\n')
    const record: EditRecord = {
      id: uidForPost(),
      postId,
      timestamp: now,
      location: pending.location,
      original: pending.original,
      modified: currentBody,
      editType: pending.editType,
    }

    const next = [...editHistory, record]
    setEditHistory(next)

    const sessionOriginal = originalDraftRef.current
    if (sessionOriginal) {
      const currentDraft: Draft = {
        title,
        body: currentBody,
        tags,
        cover,
      }
      saveDraftSession({
        postId,
        stage: stageRef.current,
        originalDraft: sessionOriginal,
        draft: currentDraft,
        editHistory: next,
        createdAt: sessionCreatedAt,
        updatedAt: now,
      })
    }

    return next
  }

  function handleSaveToKB() {
    if (stageRef.current < 2) return
    const original = originalDraftRef.current
    if (!original) return

    const now = new Date().toISOString()
    const history = applyPendingEditNow()

    const id = postId ?? uidForPost()
    const draft: Draft = {
      title,
      body: paragraphs.join('\n\n'),
      tags,
      cover,
    }

    const status = stageRef.current >= 4 ? 'finalized' : 'draft'

    setPendingPublish({
      id,
      status,
      draft,
      originalDraft: original,
      editHistory: history,
      createdAt: sessionCreatedAt || now,
      updatedAt: now,
    })

    navigate('/pending-publish')
  }

  function recordEdit() {
    // Debounce so typing doesn't add edits per keystroke.
    if (!postId) return
    if (isComposingRef.current) return
    const original = originalBodyRef.current
    pendingEditRef.current = {
      location: 'body',
      original,
      editType: 'word_replace',
    }

    if (editDebounceTimer.current) window.clearTimeout(editDebounceTimer.current)
    editDebounceTimer.current = window.setTimeout(() => {
      commitEdit()
    }, 650)
  }

  function addTagFromInput() {
    const raw = tagInput.trim()
    if (!raw) return
    const normalized = raw.replace(/^#/, '')
    if (normalized.length === 0) return
    if (tags.includes(normalized)) {
      setTagInput('')
      return
    }
    if (tags.length >= 10) return
    setTags((prev) => [...prev, normalized])
    setTagInput('')
    recordEdit()
  }

  function onChangeParagraph(idx: number, next: string) {
    if (stage >= 4) return
    const nextParas = splitIntoParagraphsForBodyEdit(next)
    setParagraphs((prev) => {
      const copy = [...prev]
      copy.splice(idx, 1, ...nextParas)
      return copy
    })
    if (!isComposingRef.current) recordEdit()
  }

  function renderCoverSlot() {
    const canUpload = stage < 4
    const showImage = cover.imageUrl && cover.type !== 'text'
    return (
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-border-muted bg-[#f2f2f2]">
        {!showImage ? (
          <div className="absolute inset-0 bg-gradient-to-br from-[#fce4ec] via-[#fff3e0] to-[#e8f5e9]" />
        ) : null}

        {showImage ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <img
              src={cover.imageUrl}
              alt="cover"
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] font-semibold text-text-secondary/80">
            {cover.type === 'photo' && '封面占位：实拍图'}
            {cover.type === 'collage' && '封面占位：拼图'}
            {cover.type === 'compare' && '封面占位：对比图'}
            {cover.type === 'list' && '封面占位：清单图'}
            {cover.type === 'text' && '封面占位：文字封面'}
          </div>
        )}

        <div className="absolute left-2 right-2 top-[18%]">
          <div className="rounded-lg bg-black/35 px-2 py-1.5 backdrop-blur">
            <input
              value={cover.overlayText}
              onChange={(e) => {
                if (stage >= 4) return
                setCover((c) => ({ ...c, overlayText: e.target.value }))
                recordEdit()
              }}
              readOnly={stage >= 4}
              placeholder="封面大字"
              className="w-full border-none bg-transparent text-center text-[14px] font-bold text-white outline-none placeholder:text-white/60 md:text-[15px]"
            />
          </div>
        </div>

        {canUpload && (
          <>
            <label className="absolute bottom-3 left-3 cursor-pointer rounded-lg border border-border-muted bg-white/95 px-2 py-1 text-[10px] font-semibold shadow-sm transition-colors hover:bg-white">
              上传图片
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = () => {
                    const result = String(reader.result ?? '')
                    setCover((c) => ({ ...c, imageUrl: result }))
                    recordEdit()
                  }
                  reader.readAsDataURL(file)
                }}
              />
            </label>
          </>
        )}
      </div>
    )
  }

  const isReadOnly = stage >= 4
  const editorStageLabel =
    stage === 1 ? '待编辑' : stage === 2 ? '草稿' : stage === 3 ? '质检' : '已定稿'
  const draftSkillMeta =
    loadedDraft && (loadedDraft.mode || loadedDraft.structureType)
      ? [loadedDraft.mode, loadedDraft.structureType].filter(Boolean).join(' · ')
      : ''

  const originalityBadge = complianceColor(originality.compliance)

  const coverTypeOptions = COVER_OPTIONS

  const draftBodyPreview = paragraphs.join('\n\n')

  return (
    <div className="flex h-full min-h-0 flex-col font-sans">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border-muted bg-surface px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-text-main">
            小红书发帖编辑器
            <span className="ml-2 font-normal text-text-tertiary">· {editorStageLabel}</span>
          </div>
          {draftSkillMeta ? (
            <div className="truncate text-[10px] font-medium text-text-secondary">{draftSkillMeta}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="whitespace-nowrap text-[10px] font-medium text-text-secondary">
            {hasDraft ? '可编辑' : '等待草稿'}
          </div>
          {hasDraft ? (
            <button
              type="button"
              onClick={() => onResetDraftSession?.()}
              className="rounded-md border border-border-muted px-2 py-1 text-[10px] font-medium text-text-secondary transition-colors hover:border-primary/30 hover:text-primary"
            >
              重置草稿
            </button>
          ) : null}
          <div className="hidden">
            <OriginalityRing userMaterialPct={originality.userMaterialPct} compliance={originality.compliance} />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas p-2">
        <div className="overflow-hidden rounded-xl border border-border-muted bg-surface">
          <div className="grid grid-cols-1 gap-4 p-3 md:grid-cols-[minmax(200px,42%)_minmax(0,1fr)] md:items-start md:gap-5 md:p-4">
            {/* 左：封面类型 + 封面（3:4 完整显示图片） */}
            <div className="flex min-w-0 flex-col gap-2 md:max-w-full">
              <div className="flex flex-wrap items-center gap-1.5">
                {coverTypeOptions.map((opt) => {
                  const active = cover.type === opt.type
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => {
                        if (isReadOnly) return
                        setCover((c) => ({ ...c, type: opt.type }))
                        recordEdit()
                      }}
                      className={
                        active
                          ? 'rounded-full border border-primary/35 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary'
                          : 'rounded-full border border-border-muted px-2.5 py-1 text-[11px] font-semibold text-text-secondary transition-colors hover:border-primary/30 hover:bg-canvas'
                      }
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              {renderCoverSlot()}
            </div>

            {/* 右：标题 / 正文 / 标签 / 报告 */}
            <div className="flex min-h-0 min-w-0 flex-col gap-3">
          {/* Title */}
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold text-text-secondary">标题</div>
              <div className="text-[10px] font-medium text-text-tertiary">{charCount}/20</div>
            </div>
            <input
              value={title}
              onChange={(e) => {
                if (isReadOnly) return
                setTitle(e.target.value)
                recordEdit()
              }}
              readOnly={isReadOnly}
              placeholder="写标题..."
              className="w-full border-none bg-transparent text-[16px] font-semibold leading-snug outline-none placeholder:text-text-secondary/70 md:text-[17px]"
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-text-secondary">正文</div>
            <div className="space-y-2">
              {paragraphs.map((p, idx) => {
                const modified = modifiedParagraphs[idx] ?? false
                return (
                  <AutoGrowParagraph
                    key={idx}
                    value={p}
                    readOnly={isReadOnly}
                    modified={modified}
                    onChange={(next) => onChangeParagraph(idx, next)}
                    onCompositionStart={() => {
                      isComposingRef.current = true
                      if (editDebounceTimer.current) {
                        window.clearTimeout(editDebounceTimer.current)
                        editDebounceTimer.current = null
                      }
                      pendingEditRef.current = null
                    }}
                    onCompositionEnd={() => {
                      if (isReadOnly) return
                      isComposingRef.current = false
                      recordEdit()
                    }}
                  />
                )
              })}
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-text-secondary">标签</div>
            <div className="flex flex-wrap items-center gap-2">
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    if (isReadOnly) return
                    setTags((prev) => prev.filter((x) => x !== t))
                    recordEdit()
                  }}
                  className="px-3 py-1 rounded-full bg-primary/10 text-primary text-[12px] font-bold hover:bg-primary/15 transition-colors flex items-center gap-1"
                  title="点击删除"
                >
                  <span>#{t}</span>
                  {!isReadOnly && <span className="text-text-secondary/80">×</span>}
                </button>
              ))}
              <div className="flex-1 min-w-[180px]">
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  readOnly={isReadOnly}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (isReadOnly) return
                      addTagFromInput()
                    }
                  }}
                  placeholder="输入标签并回车添加"
                  className="w-full bg-transparent border-none outline-none text-[13px] placeholder:text-text-secondary/70 px-2 py-1 rounded-lg"
                />
              </div>
            </div>
          </div>

          {stage >= 2 && loadedDraft?.materialAnchors && loadedDraft.materialAnchors.length > 0 ? (
            <div className="space-y-0.5 rounded-lg border border-amber-100 bg-amber-50/40 p-2">
              <div className="text-[11px] font-semibold text-text-main">素材锚点</div>
              <ul className="list-disc pl-4 text-[11px] text-text-secondary space-y-0.5">
                {loadedDraft.materialAnchors.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Originality panel */}
          <div className="mt-1 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold text-text-secondary">原创度</div>
              <OriginalityRing
                userMaterialPct={originality.userMaterialPct}
                compliance={originality.compliance}
                size={36}
                onClick={() => {
                  if (stage < 2) return
                  setIsOriginalityOpen((v) => !v)
                }}
              />
            </div>

            {isOriginalityOpen && stage >= 2 && (
              <div className={`rounded-lg border p-3 ${originalityBadge.badge}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-text-main">
                      合规评估:{' '}
                      {originality.compliance === 'safe'
                        ? '✅ 安全'
                        : originality.compliance === 'caution'
                          ? '⚠️ 建议补充素材'
                          : '🚫 风险较高'}
                    </div>
                    <div className="text-xs text-text-secondary">
                      用户素材占比: {formatPct(originality.userMaterialPct)} / AI 辅助占比:{' '}
                      {formatPct(originality.aiAssistPct)}
                    </div>
                  </div>
                  <div className="text-xs font-bold text-text-secondary whitespace-nowrap">
                    {originality.compliance.toUpperCase()}
                  </div>
                </div>
                <div className="mt-3">
                  <div className="text-xs font-bold text-text-secondary mb-2">素材来源列表</div>
                  <div className="flex flex-wrap gap-2">
                    {originality.materialSources.map((s) => (
                      <span
                        key={s}
                        className="px-2 py-1 rounded-full border border-border-muted text-[11px] font-bold text-text-secondary bg-white/60"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quality score panel */}
          {stage >= 3 && (
            <div className="mt-1 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold text-text-secondary">质量评分</div>
                <button
                  type="button"
                  onClick={() => setIsQualityOpen((v) => !v)}
                  className="rounded-md border border-border-muted px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {isQualityOpen ? '收起' : '展开'}
                </button>
              </div>
              {isQualityOpen && (
                <div className="rounded-lg border border-border-muted bg-canvas/40 p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="space-y-0">
                      <div className="text-[10px] font-medium text-text-secondary">综合分</div>
                      <div
                        className="text-2xl font-bold tabular-nums leading-none"
                        style={{ color: barFillColor(qualityTotal) }}
                      >
                        {qualityTotal}
                      </div>
                    </div>
                    <div className="text-right text-[10px] text-text-tertiary">6 维 · 示例</div>
                  </div>

                  <div className="mt-3 flex flex-col gap-1.5">
                    <Bar label="Hook" value={computedQuality.hook} />
                    <Bar label="Authentic" value={computedQuality.authentic} />
                    <Bar label="AI Smell" value={computedQuality.aiSmell} />
                    <Bar label="Diversity" value={computedQuality.diversity} />
                    <Bar label="CTA" value={computedQuality.cta} />
                    <Bar label="Platform" value={computedQuality.platform} />
                  </div>

                  <div className="mt-3">
                    <div className="mb-1 text-[10px] font-semibold text-text-secondary">建议</div>
                    <ul className="list-disc space-y-0.5 pl-4 text-[12px] leading-snug text-text-secondary">
                      {computedQuality.suggestions.map((s, idx) => (
                        <li key={`${s}-${idx}`}>{s}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Stage4 finalize */}
          {stage >= 4 && (
            <div className="mt-1 space-y-2 rounded-lg border border-border-muted bg-canvas/50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-text-main">定稿完成</div>
                  <div className="text-xs text-text-secondary mt-1">
                    复制全文 / 保存到作品集
                  </div>
                </div>
              </div>
              <div className="flex gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={async () => {
                    const full = `${title.trim()}\n\n${draftBodyPreview.trim()}`
                    try {
                      await navigator.clipboard.writeText(full)
                    } catch {
                      // ignore
                    }
                  }}
                  className="rounded-lg border border-border-muted px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-text-main/25 hover:text-text-main"
                >
                  复制全文
                </button>
                <button
                  type="button"
                  onClick={handleSaveToKB}
                  className="rounded-lg bg-text-main px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-text-main/90"
                >
                保存
                </button>
              </div>
            </div>
          )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom toolbar (fixed inside editor) */}
      <div className="shrink-0 border-t border-border-muted bg-surface px-3 py-2">
        <div className="flex items-center justify-between gap-2 md:gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0 text-[10px] font-medium text-text-secondary">
              <span>字数 {wordCount}</span>
              <span>编辑 {editCount}</span>
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-[10px] font-medium text-text-secondary">
                <span>风格学习 {Math.min(editCount, 10)}/10</span>
                {editCount >= 10 && <span className="text-success">可分析</span>}
              </div>
              <div className="h-[3px] overflow-hidden rounded-sm bg-[#F0F0F0]">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${(clamp(editCount, 0, 10) / 10) * 100}%`,
                    backgroundColor: editCount >= 10 ? '#22c55e' : 'rgba(255, 36, 66, 0.2)',
                  }}
                />
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-center">
            <OriginalityRing
              userMaterialPct={originality.userMaterialPct}
              compliance={originality.compliance}
              size={36}
              onClick={() => setIsOriginalityOpen((v) => !v)}
            />
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {stage === 2 && onSubmitQuality ? (
              <button
                type="button"
                onClick={onSubmitQuality}
                disabled={!!gatewayDisconnected}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                提交质检
              </button>
            ) : null}
            {stage < 4 ? (
              <button
                type="button"
                onClick={handleSaveToKB}
                className="rounded-lg bg-text-main px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-text-main/90"
              >
                保存到作品集
              </button>
            ) : (
              <div className="text-[10px] font-medium text-text-secondary">定稿</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

