/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveAccount } from '../contexts/ActiveAccountContext'
import { generateCoverPreview } from '../lib/coverCanvas'
import { persistableImageUrl } from '../lib/imageCompress'
import {
  addStyleSampleFromPost,
  saveDraftSession,
  savePost,
  uidForPost,
  type KnowledgePost,
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
  /** 用户点击「看我的修改规律」时由工作台发 Skill */
  onRequestStyleAnalysis?: () => void
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

/** 合并连续空行，避免 Skill 输出多换行时产生大量「空白段落」撑开版心 */
function collapseConsecutiveEmptyLines(parts: string[]): string[] {
  const out: string[] = []
  for (const part of parts) {
    if (part === '' && out.length > 0 && out[out.length - 1] === '') continue
    out.push(part)
  }
  return out.length ? out : ['']
}

/**
 * 去掉夹在两条有内容段落之间的「空段落」——Skill 常用 \n\n 分段，会多出一个空行，
 * 在按段渲染时就会变成很大的段间距。
 */
function dropEmptyParagraphGaps(parts: string[]): string[] {
  if (parts.length <= 2) return parts
  return parts.filter((p, i) => {
    if (p !== '') return true
    const prev = i > 0 ? parts[i - 1] : ''
    const next = i < parts.length - 1 ? parts[i + 1] : ''
    if (prev !== '' && next !== '') return false
    return true
  })
}

/** 与规格一致：正文按单行换行分段（保存/对比均用 \n） */
function splitBodyLines(text: string): string[] {
  const normalized = (text ?? '').replace(/\r\n/g, '\n')
  if (!normalized) return ['']
  const merged = collapseConsecutiveEmptyLines(normalized.split('\n'))
  const parts = dropEmptyParagraphGaps(merged)
  return parts.length ? parts : ['']
}

function splitBodyLinesInput(text: string): string[] {
  const normalized = (text ?? '').replace(/\r\n/g, '\n')
  if (!normalized) return ['']
  const merged = collapseConsecutiveEmptyLines(normalized.split('\n'))
  const parts = dropEmptyParagraphGaps(merged)
  return parts.length ? parts : ['']
}

function countChars(s: string) {
  return (s ?? '').length
}

/** 原创度展示用合规分档（与质检维度无关） */
function complianceFromOriginalityDisplay(displayed: number): Compliance {
  if (displayed >= 60) return 'safe'
  if (displayed >= 40) return 'caution'
  return 'risk'
}

/** 段落简化改写率：相对 original 的 title+body，衡量 current 改动了多少（0~1） */
export function calculateRewriteRatio(
  original: { title: string; body: string },
  current: { title: string; body: string },
): number {
  const originalParas = `${original.title}\n${original.body}`.split('\n').filter(Boolean)
  const currentParas = `${current.title}\n${current.body}`.split('\n').filter(Boolean)
  const currentTotal = currentParas.join('').length
  if (currentTotal === 0) return 0

  let changedChars = 0
  currentParas.forEach((para, i) => {
    if (i >= originalParas.length) {
      changedChars += para.length
    } else if (para !== originalParas[i]) {
      const o = originalParas[i]!
      let same = 0
      for (let j = 0; j < Math.min(para.length, o.length); j++) {
        if (para[j] === o[j]) same++
      }
      changedChars += para.length - same
    }
  })

  return changedChars / currentTotal
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
    const h = el.scrollHeight
    // 空段落仍占一行高度，避免浏览器 scrollHeight 过大导致段间距「空一截」
    const blank = !value.trim()
    el.style.height = `${blank ? Math.min(h, 18) : h}px`
  }, [value])

  return (
    <div
      className={
        modified
          ? 'border-l-[3px] border-l-emerald-500 pl-2'
          : 'border-l-[3px] border-l-[#e5e7eb] pl-2'
      }
      // Allow paragraph editing to only scroll vertically.
      // Body-level swipe delete uses the single right strip (not the textarea).
      style={{ touchAction: 'pan-y' }}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onCompositionStart={() => onCompositionStart?.()}
        onCompositionEnd={() => onCompositionEnd?.()}
        readOnly={readOnly}
        style={{ touchAction: 'pan-y' }}
        className="w-full resize-none outline-none bg-transparent border-none p-0 text-[13px] leading-[1.45] text-text-main placeholder:text-text-secondary/70"
        rows={1}
      />
    </div>
  )
}

/** 正文整块右侧一条侧滑区；左滑或上下滑删除，按按下位置的纵向区间对应段落。 */
function BodyParagraphsWithSideSwipe({
  paragraphs,
  readOnly,
  modifiedParagraphs,
  onChangeParagraph,
  onDeleteParagraph,
  onCompositionStart,
  onCompositionEnd,
}: {
  paragraphs: string[]
  readOnly: boolean
  modifiedParagraphs: boolean[]
  onChangeParagraph: (idx: number, next: string) => void
  onDeleteParagraph: (idx: number) => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
}) {
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  /** 与常见列表侧滑一致，略低一点便于触控命中 */
  const deleteThresholdPx = 28

  useEffect(() => {
    rowRefs.current.length = paragraphs.length
  }, [paragraphs.length])

  function indexAtClientY(y: number): number | null {
    let best: number | null = null
    let bestDist = Infinity
    for (let i = 0; i < paragraphs.length; i++) {
      const el = rowRefs.current[i]
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (y >= r.top && y <= r.bottom) return i
      const mid = (r.top + r.bottom) / 2
      const d = Math.abs(y - mid)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    return best
  }

  const textBlock = (
    <div className="min-w-0 flex-1 flex flex-col gap-0">
      {paragraphs.map((p, idx) => {
        const modified = modifiedParagraphs[idx] ?? false
        return (
          <div key={idx} ref={(el) => { rowRefs.current[idx] = el }}>
            <AutoGrowParagraph
              value={p}
              readOnly={readOnly}
              modified={modified}
              onChange={(next) => onChangeParagraph(idx, next)}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
            />
          </div>
        )
      })}
    </div>
  )

  if (readOnly) {
    return textBlock
  }

  return (
    <div className="flex min-w-0 items-stretch gap-0">
      {textBlock}
      <div
        className="relative flex w-7 shrink-0 flex-col items-stretch border-l border-border-muted/60 bg-canvas/40"
        style={{ touchAction: 'none' }}
        aria-hidden
        onPointerDown={(e) => {
          draggingRef.current = true
          startXRef.current = e.clientX
          startYRef.current = e.clientY
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            // ignore
          }
        }}
        onPointerUp={(e) => {
          if (!draggingRef.current) return
          draggingRef.current = false
          const dx = e.clientX - startXRef.current
          const dy = e.clientY - startYRef.current
          const absDx = Math.abs(dx)
          const absDy = Math.abs(dy)

          // 左滑删除（略放宽纵向分量，避免窄条上误当成「纯纵向」）
          const leftSwipe =
            dx < 0 &&
            absDx >= deleteThresholdPx &&
            absDx >= absDy * 0.45
          // 上下滑删除（▲▼ 提示）
          const verticalSwipe =
            absDy >= deleteThresholdPx &&
            absDy >= absDx * 0.45

          if (!leftSwipe && !verticalSwipe) return

          const idx = indexAtClientY((startYRef.current + e.clientY) / 2)
          if (idx !== null) onDeleteParagraph(idx)
        }}
        onPointerCancel={() => {
          draggingRef.current = false
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-0.5 py-1">
          <span className="shrink-0 text-[8px] leading-none text-text-secondary/70">▲</span>
          <div className="min-h-[12px] w-0.5 flex-1 rounded-full bg-text-secondary/35" />
          <span className="shrink-0 text-[8px] leading-none text-text-secondary/70">▼</span>
        </div>
      </div>
    </div>
  )
}

export default function XhsPostEditor({
  stage = 1,
  loadedDraft,
  originalDraft,
  originalityReport,
  qualityScore,
  onSaveToKB: _onSaveToKB,
  onDraftChange,
  onSubmitQuality,
  gatewayDisconnected: _gatewayDisconnected,
  onResetDraftSession,
  onRequestStyleAnalysis,
}: Props) {
  const navigate = useNavigate()
  const { activeAccount, addCumulativeEditsToActiveAccount } = useActiveAccount()
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

  const [coverImageFile, setCoverImageFile] = useState<File | null>(null)
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [appliedSuggestionIds, setAppliedSuggestionIds] = useState<Record<string, boolean>>({})
  const [showDeepQualityLink, setShowDeepQualityLink] = useState(false)
  const coverCompositeObjectUrlRef = useRef<string | null>(null)
  const idleQualityTimerRef = useRef<number | null>(null)
  /** 基准草稿变更后用于重算 debounce 改写率 */
  const [originalitySessionTick, setOriginalitySessionTick] = useState(0)
  /** 1s debounce 后的改写率（0~1） */
  const [debouncedRewriteRatio, setDebouncedRewriteRatio] = useState(0)

  const persistedSessionEditCountRef = useRef(0)
  const editHistoryLengthRef = useRef(0)
  editHistoryLengthRef.current = editHistory.length

  const hasDraft = stage >= 2 && !!loadedDraft
  const editCount = editHistory.length

  const historicalEditCount = activeAccount.cumulativeEditCount ?? 0
  const totalEditCount = historicalEditCount + editCount
  const progressToNext = totalEditCount % 10
  const styleProgressDisplay = totalEditCount > 0 && progressToNext === 0 ? 10 : progressToNext
  const styleBarWidthPct =
    totalEditCount > 0 && progressToNext === 0 ? 100 : (progressToNext / 10) * 100
  const styleAnalysisCount = activeAccount.styleAnalysisCount ?? 0
  /** 下一轮可触发风格分析所需的累计编辑下限（10、20、30…） */
  const nextStyleAnalysisAt = (styleAnalysisCount + 1) * 10
  const showStyleAnalysisPrompt =
    totalEditCount >= nextStyleAnalysisAt && typeof onRequestStyleAnalysis === 'function'

  const flushSessionEditsToAccount = useCallback(() => {
    const delta = editHistory.length - persistedSessionEditCountRef.current
    if (delta > 0) {
      addCumulativeEditsToActiveAccount(delta)
      persistedSessionEditCountRef.current = editHistory.length
    }
  }, [editHistory.length, addCumulativeEditsToActiveAccount])

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
    persistedSessionEditCountRef.current = 0
    setDebouncedRewriteRatio(0)
    setCoverImageFile(null)
    if (coverCompositeObjectUrlRef.current) {
      URL.revokeObjectURL(coverCompositeObjectUrlRef.current)
      coverCompositeObjectUrlRef.current = null
    }
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
    setParagraphs(splitBodyLines(loadedDraft.body))
    setOriginalParagraphs(splitBodyLines(loadedDraft.body))
    const now = new Date().toISOString()
    const nextPostId = uidForPost()
    setPostId(nextPostId)
    setEditHistory([])
    setSessionCreatedAt(now)
    persistedSessionEditCountRef.current = 0
    setCoverImageFile(null)
    if (coverCompositeObjectUrlRef.current) {
      URL.revokeObjectURL(coverCompositeObjectUrlRef.current)
      coverCompositeObjectUrlRef.current = null
    }

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
    setOriginalitySessionTick((t) => t + 1)
  }, [stage, loadedDraft])

  // If stage >= 3 and original draft is passed, use it for diff marking.
  useEffect(() => {
    if (stage < 3) return
    if (!originalDraft) return
    setOriginalParagraphs(splitBodyLines(originalDraft.body))
  }, [stage, originalDraft])

  // Keep refs in sync for debounced persistence.
  useEffect(() => {
    stageRef.current = stage
  }, [stage])

  useEffect(() => {
    draftRef.current = {
      title,
      body: paragraphs.join('\n'),
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
        body: paragraphs.join('\n'),
        tags,
        cover,
      })
    }, 250)

    return () => window.clearTimeout(t)
  }, [onDraftChange, stage, title, paragraphs, tags, cover])

  // 原创度改写率：编辑后 1s debounce 再更新（基线来自 Skill 或默认 10%）
  useEffect(() => {
    const orig = originalDraftRef.current
    if (!orig) {
      setDebouncedRewriteRatio(0)
      return
    }
    const t = window.setTimeout(() => {
      const current = { title, body: paragraphs.join('\n') }
      setDebouncedRewriteRatio(calculateRewriteRatio(orig, current))
    }, 1000)
    return () => window.clearTimeout(t)
  }, [title, paragraphs, originalitySessionTick])

  // 用户上传照片后：Canvas 合成封面预览（大字变更时重算）
  useEffect(() => {
    if (!coverImageFile) return
    let cancelled = false
    void generateCoverPreview(coverImageFile, cover.overlayText).then((blob) => {
      if (cancelled || !blob) return
      if (coverCompositeObjectUrlRef.current) {
        URL.revokeObjectURL(coverCompositeObjectUrlRef.current)
      }
      const url = URL.createObjectURL(blob)
      coverCompositeObjectUrlRef.current = url
      setCover((c) => ({ ...c, imageUrl: url, type: 'photo' }))
    })
    return () => {
      cancelled = true
    }
  }, [coverImageFile, cover.overlayText])

  useEffect(() => {
    if (qualityScore) {
      setAiPanelOpen(true)
    }
  }, [qualityScore])

  useEffect(() => {
    if (stage !== 2 || !onSubmitQuality) {
      setShowDeepQualityLink(false)
      return
    }
    setShowDeepQualityLink(false)
    if (idleQualityTimerRef.current) window.clearTimeout(idleQualityTimerRef.current)
    idleQualityTimerRef.current = window.setTimeout(() => {
      setShowDeepQualityLink(true)
    }, 5000)
    return () => {
      if (idleQualityTimerRef.current) window.clearTimeout(idleQualityTimerRef.current)
    }
  }, [stage, title, paragraphs, cover.overlayText, cover.imageUrl, tags, onSubmitQuality])

  useEffect(() => {
    return () => {
      const delta = editHistoryLengthRef.current - persistedSessionEditCountRef.current
      if (delta > 0) {
        addCumulativeEditsToActiveAccount(delta)
        persistedSessionEditCountRef.current = editHistoryLengthRef.current
      }
    }
  }, [addCumulativeEditsToActiveAccount])

  const originality = useMemo<OriginalityReport>(() => {
    const baselineFromSkill = originalityReport?.userMaterialPct ?? 10
    const displayedOriginality = clamp(
      baselineFromSkill + debouncedRewriteRatio * 90,
      0,
      100,
    )
    const compliance = complianceFromOriginalityDisplay(displayedOriginality)
    const aiAssistPct = clamp(100 - displayedOriginality, 0, 100)
    const materialSources =
      originalityReport?.materialSources?.length ? originalityReport.materialSources : ['用户直接输入']

    return {
      userMaterialPct: displayedOriginality,
      aiAssistPct,
      compliance,
      materialSources,
    }
  }, [originalityReport, debouncedRewriteRatio])

  const modifiedParagraphs = useMemo(() => {
    return paragraphs.map((p, idx) => {
      const o = originalParagraphs[idx] ?? ''
      return idx >= originalParagraphs.length || p !== o
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
    const currentBody = paragraphs.join('\n')
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

  async function handleSaveToKB() {
    if (stageRef.current < 2) return
    flushSessionEditsToAccount()
    const original = originalDraftRef.current
    if (!original) return

    const now = new Date().toISOString()
    const history = applyPendingEditNow()

    const id = postId ?? uidForPost()
    const storedImageUrl = await persistableImageUrl(cover.imageUrl)
    const draft: Draft = {
      title,
      body: paragraphs.join('\n'),
      tags,
      cover: { ...cover, imageUrl: storedImageUrl },
    }

    const status: KnowledgePost['status'] = stageRef.current >= 4 ? 'finalized' : 'draft'

    const post = {
      id,
      status,
      title: draft.title,
      body: draft.body,
      tags: draft.tags,
      cover: draft.cover,
      originalDraft: original,
      editHistory: history,
      createdAt: sessionCreatedAt || now,
      updatedAt: now,
    }

    savePost(post)
    addStyleSampleFromPost(post)
    navigate('/knowledge-base')
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

    // 本段被删空：去掉该段 DOM，避免留下带绿条/侧栏的空白块（至少保留一段可编辑）
    if (!next.trim()) {
      if (isComposingRef.current) {
        setParagraphs((prev) => {
          const copy = [...prev]
          copy[idx] = next
          return copy
        })
        return
      }
      setParagraphs((prev) => {
        if (prev.length <= 1) return ['']
        const copy = [...prev]
        copy.splice(idx, 1)
        return copy.length ? copy : ['']
      })
      setOriginalParagraphs((prev) => {
        if (prev.length <= 1) return prev
        const copy = [...prev]
        copy.splice(idx, 1)
        return copy.length ? copy : ['']
      })
      if (!isComposingRef.current) recordEdit()
      return
    }

    const nextParas = splitBodyLinesInput(next)
    setParagraphs((prev) => {
      const copy = [...prev]
      copy.splice(idx, 1, ...nextParas)
      return copy
    })
    if (!isComposingRef.current) recordEdit()
  }

  function deleteParagraph(idx: number) {
    if (stage >= 4) return
    setParagraphs((prev) => {
      const copy = [...prev]
      copy.splice(idx, 1)
      return copy.length ? copy : ['']
    })
    setOriginalParagraphs((prev) => {
      const copy = [...prev]
      copy.splice(idx, 1)
      return copy.length ? copy : ['']
    })
    if (!isComposingRef.current) recordEdit()
  }

  function coverTypeLabel(t: CoverType): string {
    const m: Record<CoverType, string> = {
      photo: '实拍图',
      text: '文字封面',
      collage: '拼图',
      compare: '对比图',
      list: '清单图',
    }
    return m[t] ?? '推荐'
  }

  async function handleDownloadCover() {
    if (!coverImageFile) return
    const blob = await generateCoverPreview(coverImageFile, cover.overlayText)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ideashu-cover.jpg'
    a.click()
    URL.revokeObjectURL(url)
  }

  function renderCoverSlot() {
    const canEdit = stage < 4
    const hasUserPhoto = coverImageFile !== null
    const skillCover = loadedDraft?.cover
    const suggestType = skillCover?.type ?? cover.type
    const suggestDesc = (skillCover?.description ?? cover.description ?? '').trim() || '（暂无画面描述）'
    const overlayLen = (cover.overlayText || '').length
    const overlayFontPx = Math.min(24, Math.max(14, 22 - Math.floor(overlayLen / 6)))

    return (
      <div className="flex min-w-0 flex-col gap-2">
        <div
          className={`relative aspect-[3/4] w-full overflow-hidden rounded-xl border ${
            hasUserPhoto ? 'border-border-muted bg-black/5' : 'border-dashed border-border-muted'
          }`}
        >
          {!hasUserPhoto ? (
            <>
              <div
                className="absolute inset-0 bg-gradient-to-br from-[#fce4ec] via-[#fff3e0] to-[#e8f5e9]"
                aria-hidden
              />
              <div className="relative z-10 flex h-full min-h-[200px] flex-col justify-between p-3">
                <div className="space-y-2">
                  <div className="inline-flex rounded-full border border-white/60 bg-white/70 px-2.5 py-1 text-[11px] font-bold text-primary shadow-sm backdrop-blur-sm">
                    推荐类型 · {coverTypeLabel(suggestType)}
                  </div>
                  <p className="rounded-lg border border-white/50 bg-white/65 px-2.5 py-2 text-[12px] leading-snug text-text-main shadow-sm backdrop-blur-sm">
                    {suggestDesc}
                  </p>
                  <div className="rounded-lg border border-white/60 bg-white/75 px-2 py-2.5 text-center shadow-sm backdrop-blur-sm">
                    <div className="text-[10px] font-semibold text-text-secondary">
                      封面大字（来自 Skill，可上传后叠加）
                    </div>
                    <div
                      className="mt-1 font-bold text-text-main"
                      style={{ fontSize: `${Math.min(20, Math.max(14, 18 - overlayLen / 8))}px` }}
                    >
                      {cover.overlayText || '—'}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-white/55 bg-white/60 py-2 text-center text-[11px] font-semibold text-text-main shadow-sm backdrop-blur-sm">
                  上传你拍的照片作为封面
                </div>
              </div>
            </>
          ) : (
            <>
              <img
                src={cover.imageUrl}
                alt="封面预览"
                className="h-full w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-3">
                <input
                  value={cover.overlayText}
                  onChange={(e) => {
                    if (!canEdit) return
                    setCover((c) => ({ ...c, overlayText: e.target.value }))
                    recordEdit()
                  }}
                  readOnly={!canEdit}
                  placeholder="封面大字"
                  className="pointer-events-auto w-full border-none bg-transparent text-center font-bold text-white outline-none placeholder:text-white/50"
                  style={{ fontSize: `${overlayFontPx}px` }}
                />
              </div>
            </>
          )}
        </div>

        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <label className="cursor-pointer rounded-lg border border-border-muted bg-surface px-3 py-1.5 text-[11px] font-semibold text-text-main transition-colors hover:border-primary/40 hover:text-primary">
              {hasUserPhoto ? '更换照片' : '上传照片'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  setCoverImageFile(file)
                  recordEdit()
                }}
              />
            </label>
            <button
              type="button"
              disabled={!hasUserPhoto}
              onClick={() => void handleDownloadCover()}
              className="rounded-lg border border-border-muted bg-surface px-3 py-1.5 text-[11px] font-semibold text-text-main transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              下载封面
            </button>
          </div>
        ) : null}
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

  const draftBodyPreview = paragraphs.join('\n')

  const aiSuggestionItems = useMemo(() => {
    const sug = qualityScore?.suggestions ?? []
    const n = Math.max(paragraphs.length, 1)
    return sug.map((text, i) => ({
      id: `ai-sug-${i}`,
      paragraphIndex: i % n,
      text,
      applied: !!appliedSuggestionIds[`ai-sug-${i}`],
    }))
  }, [qualityScore, paragraphs.length, appliedSuggestionIds])

  function applyAiSuggestion(id: string, paragraphIndex: number, text: string) {
    if (stage >= 4) return
    setParagraphs((prev) => {
      const next = [...prev]
      if (paragraphIndex >= 0 && paragraphIndex < next.length) {
        next[paragraphIndex] = text
      }
      return next
    })
    setAppliedSuggestionIds((prev) => ({ ...prev, [id]: true }))
    recordEdit()
  }

  function originalityBarColor(pct: number) {
    if (pct >= 60) return '#22c55e'
    if (pct >= 40) return '#eab308'
    return '#ef4444'
  }

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
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas p-2">
        <div className="overflow-hidden rounded-xl border border-border-muted bg-surface">
          <div className="grid grid-cols-1 gap-4 p-3 md:grid-cols-[minmax(200px,42%)_minmax(0,1fr)] md:items-start md:gap-5 md:p-4">
            {/* 左：封面预览 */}
            <div className="flex min-w-0 flex-col gap-2 md:max-w-full">{renderCoverSlot()}</div>

            {/* 右：标题 / 正文 / 标签 + AI 建议 */}
            <div className="relative flex min-h-0 min-w-0 flex-col gap-3">
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

          {/* Body：按段竖线标记 AI / 用户改写 */}
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-text-secondary">正文</div>
            <BodyParagraphsWithSideSwipe
              paragraphs={paragraphs}
              readOnly={isReadOnly}
              modifiedParagraphs={modifiedParagraphs}
              onChangeParagraph={onChangeParagraph}
              onDeleteParagraph={(idx) => {
                if (isReadOnly) return
                deleteParagraph(idx)
              }}
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

          {/* AI 建议（右上可折叠） */}
          {hasDraft ? (
            <div className="pointer-events-none absolute right-0 top-0 z-10 flex max-w-full flex-col items-end gap-1 pr-0">
              <div className="pointer-events-auto flex flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={() => setAiPanelOpen((v) => !v)}
                  className="relative flex h-8 w-8 items-center justify-center rounded-full border border-border-muted bg-surface text-[15px] shadow-sm transition-colors hover:border-primary/40"
                  title="AI 建议"
                >
                  💡
                  {aiSuggestionItems.length > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
                      {aiSuggestionItems.length}
                    </span>
                  ) : null}
                </button>
                {aiPanelOpen ? (
                  <div className="w-[min(100%,18rem)] rounded-xl border border-border-muted bg-surface p-3 shadow-lg">
                    <div className="mb-2 text-[11px] font-bold text-text-main">AI 建议</div>
                    {stage < 3 || aiSuggestionItems.length === 0 ? (
                      <p className="text-[11px] leading-snug text-text-secondary">
                        编辑完成后点击「深度质检」获取 AI 修改建议（阶段二暂无质检数据）。
                      </p>
                    ) : (
                      <ul className="max-h-[240px] space-y-2 overflow-y-auto pr-0.5">
                        {aiSuggestionItems.map((item) => (
                          <li
                            key={item.id}
                            className={`rounded-lg border border-border-muted p-2 text-[11px] ${
                              item.applied ? 'bg-canvas/50 opacity-60 line-through' : 'bg-canvas/30'
                            }`}
                          >
                            <div className="font-semibold text-text-secondary">第 {item.paragraphIndex + 1} 段</div>
                            <p className="mt-1 text-text-main">{item.text}</p>
                            {!item.applied ? (
                              <button
                                type="button"
                                onClick={() => applyAiSuggestion(item.id, item.paragraphIndex, item.text)}
                                className="mt-2 rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-white hover:bg-primary/90"
                              >
                                采纳
                              </button>
                            ) : (
                              <span className="mt-1 inline-block text-[10px] text-text-tertiary">已采纳</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

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
                  onClick={() => void handleSaveToKB()}
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

      {/* Bottom toolbar：三栏 — 字数 / 原创度 / 风格学习 + 保存 */}
      <div className="shrink-0 border-t border-border-muted bg-surface px-2 py-2 md:px-3">
        <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-3 md:gap-3">
          <div className="min-w-0 text-center md:text-left">
            <div className="text-[11px] font-semibold text-text-secondary">字数</div>
            <div className="text-lg font-black tabular-nums text-text-main">{wordCount}</div>
          </div>

          <div className="min-w-0 flex flex-col items-stretch gap-1 px-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold text-text-secondary">原创度</span>
              <span
                className="text-[11px] font-black tabular-nums"
                style={{ color: originalityBarColor(originality.userMaterialPct) }}
              >
                {Math.round(originality.userMaterialPct)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#f0f0f0]">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${clamp(originality.userMaterialPct, 0, 100)}%`,
                  backgroundColor: originalityBarColor(originality.userMaterialPct),
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-text-tertiary">
                {originality.compliance === 'safe'
                  ? '✅ 合规'
                  : originality.compliance === 'caution'
                    ? '⚠️ 注意'
                    : '❌ 风险'}
              </span>
              {stage === 2 && onSubmitQuality && showDeepQualityLink ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowDeepQualityLink(false)
                    onSubmitQuality()
                  }}
                  className="text-[10px] font-semibold text-primary underline-offset-2 hover:underline"
                >
                  深度质检
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex min-w-0 flex-col items-stretch gap-1 md:items-end">
            <div className="w-full md:max-w-[200px] md:self-end">
              <div className="flex items-center justify-between text-[10px] font-medium text-text-secondary">
                <span>
                  风格 {styleProgressDisplay}/10
                  {totalEditCount > 0 && progressToNext === 0 ? (
                    <span className="ml-1 text-emerald-600">已满档</span>
                  ) : null}
                </span>
              </div>
              <div className="mt-0.5 h-[3px] overflow-hidden rounded-sm bg-[#F0F0F0]">
                <div
                  className="h-full rounded-sm transition-[width] duration-300"
                  style={{
                    width: `${styleBarWidthPct}%`,
                    backgroundColor:
                      totalEditCount > 0 && progressToNext === 0 ? '#22c55e' : 'rgba(255, 36, 66, 0.2)',
                  }}
                />
              </div>
            </div>
            {showStyleAnalysisPrompt ? (
              <button
                type="button"
                onClick={() => onRequestStyleAnalysis?.()}
                className="mt-1 self-end rounded border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/10"
              >
                看我的修改规律
              </button>
            ) : null}
            <div className="mt-1 flex justify-end gap-1.5">
              {stage < 4 ? (
                <button
                  type="button"
                  onClick={() => void handleSaveToKB()}
                  className="rounded-lg bg-text-main px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-text-main/90"
                >
                  保存到作品集
                </button>
              ) : (
                <span className="text-[10px] text-text-secondary">已定稿</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

