/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveAccount } from '../contexts/ActiveAccountContext'
import { persistableImageUrl } from '../lib/imageCompress'
import {
  addStyleSampleFromPost,
  loadPosts,
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
  /** 与 `json:draft` / 会话恢复对齐；`json:cover` 不应改变，避免整表重置 */
  draftSessionId?: number
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
  /** 用户确认封面建议后，由工作台向网关发消息触发 ```json:cover``` 生图 */
  onRequestCoverGeneration?: (args: {
    wireMessage: string
    imageDataUrl?: string
    /** true 时走素材库 + img2img 话术（用户已上传底图） */
    useUploadedImageAsCoverBase?: boolean
  }) => void
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function normalizeDraftBody(text: string) {
  return (text ?? '').replace(/\r\n/g, '\n')
}

function countChars(s: string) {
  return (s ?? '').length
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(file)
  })
}

/** 草稿一有内容即可展示，不依赖 Skill 先返回 cover.description */
function buildLocalCoverSuggestion(title: string, body: string, tags: string[]): string {
  const t = title.trim()
  const b = body.trim().replace(/\s+/g, ' ')
  const snippet = b.length > 160 ? `${b.slice(0, 160)}…` : b
  const tagHint = tags.length ? `可呼应标签：${tags.slice(0, 4).join('、')}` : ''
  if (!t && !snippet) return '完善标题或正文后，这里会给出封面画面建议。'
  return [
    '竖版约 3:4，生活化光影与真实场景，留白给大字标题区。',
    t ? `视觉锚点：${t}` : '',
    snippet ? `画面叙事：${snippet}` : '',
    tagHint,
  ]
    .filter(Boolean)
    .join('\n')
}

/** 仅用于发往对话的封面设计提示（不含正文摘录），无 Skill 描述时与 buildLocalCoverSuggestion 解耦 */
function buildCoverWireDesignPrompt(title: string, tags: string[]): string {
  const t = title.trim()
  const tagHint = tags.length ? `可呼应标签：${tags.slice(0, 2).join('、')}` : ''
  if (!t && !tagHint) {
    return '竖版约 3:4，生活化光影与真实场景，留白给大字标题区。'
  }
  return [
    '竖版约 3:4，生活化光影与真实场景，留白给大字标题区。',
    t ? `视觉锚点：${t}` : '',
    tagHint,
  ]
    .filter(Boolean)
    .join('\n')
}

function composeCoverWireMessage(params: {
  title: string
  suggestion: string
  overlayText: string
  mode: 'text2img' | 'img2img'
}): string {
  const { title, suggestion, overlayText, mode } = params
  const modeLine =
    mode === 'img2img'
      ? '生成模式：img2img（已随消息附带用户上传的底图素材，请以此为底生成封面，保留主体场景，保持自然真实感）'
      : '生成模式：text2img（无用户底图）'
  return [
    '请为当前编辑器草稿输出 ```json:cover``` 并走生图流程，生成小红书竖版封面（约 3:4）。',
    modeLine,
    '风格：倾向自然光或日常室内光、手机实拍/轻后期感、真实生活场景、留白给标题，像常见小红书笔记封面；避免赛博霓虹、过度 CG、炫光科技风、游戏/概念海报式的泛 AI 插画。',
    '要求：直接输出可用的 json:cover（含 overlayText 等），完成生图并回填 imageUrl；封面大字须由模型绘入成图，客户端不合字。不要反问用户。',
    `草稿标题：${title.trim() || '（空）'}`,
    `封面叠字：${overlayText.trim() || title.trim() || '（请据标题生成）'}`,
    `封面设计提示词（请严格参考）：${suggestion}`,
  ].join('\n')
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

export default function XhsPostEditor({
  stage = 1,
  draftSessionId = 0,
  loadedDraft,
  originalDraft,
  originalityReport,
  qualityScore,
  onSaveToKB: _onSaveToKB,
  onDraftChange,
  onSubmitQuality,
  gatewayDisconnected = false,
  onResetDraftSession,
  onRequestStyleAnalysis,
  onRequestCoverGeneration,
}: Props) {
  const navigate = useNavigate()
  const { activeAccount, activeAccountId } = useActiveAccount()
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [cover, setCover] = useState<CoverData>({
    type: 'photo',
    description: '',
    overlayText: '',
    imageUrl: undefined,
  })

  const [body, setBody] = useState('')
  /** 阶段三起用于整条正文左侧「是否相对基准有改动」；阶段二与载入时正文一致 */
  const [originalBodySnapshot, setOriginalBodySnapshot] = useState('')

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
  const coverUploadObjectUrlRef = useRef<string | null>(null)
  const idleQualityTimerRef = useRef<number | null>(null)
  /** 基准草稿变更后用于重算 debounce 改写率 */
  const [originalitySessionTick, setOriginalitySessionTick] = useState(0)
  /** 1s debounce 后的改写率（0~1） */
  const [debouncedRewriteRatio, setDebouncedRewriteRatio] = useState(0)

  const hasDraft = stage >= 2 && !!loadedDraft

  const localCoverSuggestion = useMemo(
    () => buildLocalCoverSuggestion(title, body, tags),
    [title, body, tags],
  )

  const [coverGenSubmitting, setCoverGenSubmitting] = useState(false)

  useEffect(() => {
    const u =
      loadedDraft?.cover?.imageUrl?.trim() ||
      cover.imageUrl?.trim()
    if (u && (/^https?:\/\//i.test(u) || u.startsWith('data:image/'))) {
      setCoverGenSubmitting(false)
    }
  }, [loadedDraft?.cover?.imageUrl, cover.imageUrl])

  const portfolioSaveCount = useMemo(
    () => loadPosts(activeAccountId).length,
    [activeAccountId],
  )
  const progressToNext = portfolioSaveCount % 10
  const styleProgressDisplay =
    portfolioSaveCount > 0 && progressToNext === 0 ? 10 : progressToNext
  const styleBarWidthPct =
    portfolioSaveCount > 0 && progressToNext === 0 ? 100 : (progressToNext / 10) * 100
  const styleAnalysisCount = activeAccount.styleAnalysisCount ?? 0
  /** 下一轮可触发风格分析所需的作品集保存篇数（10、20、30…） */
  const nextStyleAnalysisAt = (styleAnalysisCount + 1) * 10
  const showStyleAnalysisPrompt =
    portfolioSaveCount >= nextStyleAnalysisAt && typeof onRequestStyleAnalysis === 'function'

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
    setBody('')
    setOriginalBodySnapshot('')
    setPostId(null)
    setEditHistory([])
    setSessionCreatedAt('')
    setDebouncedRewriteRatio(0)
    setCoverImageFile(null)
    if (coverUploadObjectUrlRef.current) {
      URL.revokeObjectURL(coverUploadObjectUrlRef.current)
      coverUploadObjectUrlRef.current = null
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

  const loadedDraftRef = useRef(loadedDraft)
  loadedDraftRef.current = loadedDraft

  // Load stage2/3 draft：仅在新的草稿会话（draftSessionId）时整表初始化，不因 `json:cover` 单独到达而重置。
  // stage 3 与 2 共用同一套表单数据；若仅在 stage 2 hydrate，网关残留的 score 会把 stage 顶到 3 导致永远不灌入正文。
  useEffect(() => {
    if (stage !== 2 && stage !== 3) return
    const ld = loadedDraftRef.current
    if (!ld) return
    if (editDebounceTimer.current) window.clearTimeout(editDebounceTimer.current)
    editDebounceTimer.current = null
    pendingEditRef.current = null

    setTitle(ld.title)
    setTags(ld.tags)
    setTagInput('')
    const c0 = ld.cover
    setCover(
      c0.imageUrl?.trim()
        ? { ...c0, type: 'photo' }
        : c0,
    )
    const b0 = normalizeDraftBody(ld.body)
    setBody(b0)
    setOriginalBodySnapshot(b0)
    const now = new Date().toISOString()
    const nextPostId = uidForPost()
    setPostId(nextPostId)
    setEditHistory([])
    setSessionCreatedAt(now)
    setCoverImageFile(null)
    if (coverUploadObjectUrlRef.current) {
      URL.revokeObjectURL(coverUploadObjectUrlRef.current)
      coverUploadObjectUrlRef.current = null
    }

    originalDraftRef.current = ld
    originalTitleRef.current = ld.title
    originalTagsRef.current = ld.tags
    originalBodyRef.current = ld.body
    originalCoverRef.current = ld.cover

    saveDraftSession(activeAccountId, {
      postId: nextPostId,
      stage: 2,
      originalDraft: ld,
      draft: ld,
      editHistory: [],
      createdAt: now,
      updatedAt: now,
    })
    setOriginalitySessionTick((t) => t + 1)
  }, [stage, draftSessionId, activeAccountId])

  // 同一草稿会话内仅封面字段从父级更新（如晚到的 `json:cover`），不重置 postId / 编辑历史。
  useEffect(() => {
    if (stage !== 2 && stage !== 3) return
    if (!loadedDraft) return
    const c0 = loadedDraft.cover
    setCover((prev) => {
      const prevUrl = prev.imageUrl ?? ''
      const trimmedIncoming = c0.imageUrl?.trim()
      const nextUrl =
        trimmedIncoming && trimmedIncoming.length > 0 ? trimmedIncoming : prevUrl
      if (
        prevUrl.startsWith('blob:') &&
        nextUrl !== prevUrl &&
        coverUploadObjectUrlRef.current === prevUrl
      ) {
        URL.revokeObjectURL(prevUrl)
        coverUploadObjectUrlRef.current = null
      }
      return {
        ...prev,
        type: (c0.type as CoverType) ?? prev.type ?? 'photo',
        description: c0.description ?? prev.description,
        overlayText: c0.overlayText ?? prev.overlayText,
        imageUrl: nextUrl,
      }
    })
    originalCoverRef.current = loadedDraft.cover
  }, [
    stage,
    loadedDraft?.cover?.imageUrl,
    loadedDraft?.cover?.overlayText,
    loadedDraft?.cover?.description,
    loadedDraft?.cover?.type,
  ])

  // If stage >= 3 and original draft is passed, use it for diff marking.
  useEffect(() => {
    if (stage < 3) return
    if (!originalDraft) return
    setOriginalBodySnapshot(normalizeDraftBody(originalDraft.body))
  }, [stage, originalDraft])

  // Keep refs in sync for debounced persistence.
  useEffect(() => {
    stageRef.current = stage
  }, [stage])

  useEffect(() => {
    draftRef.current = {
      title,
      body,
      tags,
      cover,
    }
  }, [title, tags, body, cover])

  // WS integration helper: expose a debounced snapshot of the editor draft to the parent.
  useEffect(() => {
    if (!onDraftChange) return
    if (stage < 2) return

    const t = window.setTimeout(() => {
      onDraftChange({
        title,
        body,
        tags,
        cover,
      })
    }, 250)

    return () => window.clearTimeout(t)
  }, [onDraftChange, stage, title, body, tags, cover])

  // 原创度改写率：编辑后 1s debounce 再更新（基线来自 Skill 或默认 10%）
  useEffect(() => {
    const orig = originalDraftRef.current
    if (!orig) {
      setDebouncedRewriteRatio(0)
      return
    }
    const t = window.setTimeout(() => {
      const current = { title, body }
      setDebouncedRewriteRatio(calculateRewriteRatio(orig, current))
    }, 1000)
    return () => window.clearTimeout(t)
  }, [title, body, originalitySessionTick])

  // 用户上传照片后：原图 blob 预览（大字改不改图，由 json:cover 生图写入）
  useEffect(() => {
    if (!coverImageFile) {
      if (coverUploadObjectUrlRef.current) {
        URL.revokeObjectURL(coverUploadObjectUrlRef.current)
        coverUploadObjectUrlRef.current = null
      }
      return
    }
    const url = URL.createObjectURL(coverImageFile)
    coverUploadObjectUrlRef.current = url
    setCover((c) => ({ ...c, imageUrl: url, type: 'photo' }))
    return () => {
      URL.revokeObjectURL(url)
      if (coverUploadObjectUrlRef.current === url) {
        coverUploadObjectUrlRef.current = null
      }
    }
  }, [coverImageFile])

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
  }, [stage, title, body, cover.overlayText, cover.imageUrl, tags, onSubmitQuality])

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

  const bodyModified = useMemo(() => body !== originalBodySnapshot, [body, originalBodySnapshot])

  const charCount = useMemo(() => countChars(title), [title])

  const wordCount = useMemo(() => {
    // Rough count: count non-space characters in body + title.
    const text = `${title}\n${body}`
    return text.replace(/\s/g, '').length
  }, [title, body])

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
        saveDraftSession(activeAccountId, {
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
    const currentBody = body
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
      saveDraftSession(activeAccountId, {
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
    const original = originalDraftRef.current
    if (!original) return

    const now = new Date().toISOString()
    const history = applyPendingEditNow()

    const id = postId ?? uidForPost()
    const storedImageUrl = await persistableImageUrl(cover.imageUrl)
    const draft: Draft = {
      title,
      body,
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

    savePost(activeAccountId, post)
    addStyleSampleFromPost(activeAccountId, post)
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
    let blob: Blob | null = null
    const src = cover.imageUrl?.trim() || loadedDraft?.cover?.imageUrl?.trim() || ''
    if (
      src.startsWith('http://') ||
      src.startsWith('https://') ||
      src.startsWith('blob:') ||
      src.startsWith('data:image/')
    ) {
      try {
        const res = await fetch(src)
        blob = await res.blob()
      } catch {
        return
      }
    } else if (coverImageFile) {
      blob = coverImageFile
    }
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ideashu-cover.jpg'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleConfirmCoverGen() {
    if (!onRequestCoverGeneration || gatewayDisconnected || coverGenSubmitting) return
    const skillCoverDesc = (loadedDraft?.cover?.description ?? '').trim()
    const suggestion = skillCoverDesc || buildCoverWireDesignPrompt(title, tags)
    const mode = coverImageFile ? ('img2img' as const) : ('text2img' as const)
    let imageDataUrl: string | undefined
    if (coverImageFile) {
      try {
        imageDataUrl = await fileToDataUrl(coverImageFile)
      } catch {
        return
      }
    }
    const wireMessage = composeCoverWireMessage({
      title,
      suggestion,
      overlayText: cover.overlayText.trim() || title.trim(),
      mode,
    })
    setCoverGenSubmitting(true)
    onRequestCoverGeneration({
      wireMessage,
      imageDataUrl,
      useUploadedImageAsCoverBase: !!coverImageFile,
    })
    window.setTimeout(() => setCoverGenSubmitting(false), 25_000)
  }

  function renderCoverSlot() {
    const canEdit = stage < 4
    const draftHasTextForCover =
      title.trim().length > 0 || body.trim().replace(/\s+/g, '').length >= 8
    const hasDisplayImage = coverImageFile !== null || !!(cover.imageUrl && cover.imageUrl.trim().length > 0)
    const canDownloadCover =
      coverImageFile !== null ||
      !!(cover.imageUrl?.trim() || loadedDraft?.cover?.imageUrl?.trim())
    const skillCover = loadedDraft?.cover
    const suggestType =
      hasDisplayImage ? ('photo' as CoverType) : (skillCover?.type ?? cover.type)
    const displaySuggestion =
      (skillCover?.description ?? cover.description ?? '').trim() || localCoverSuggestion
    const overlayLen = (cover.overlayText || '').length

    return (
      <div className="flex min-w-0 flex-col gap-2">
        <div
          className={`w-full overflow-hidden rounded-xl border ${
            hasDisplayImage
              ? 'border-border-muted bg-black/5'
              : 'relative aspect-[3/4] border-dashed border-border-muted'
          }`}
        >
          {!hasDisplayImage ? (
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
                  <p className="rounded-lg border border-white/50 bg-white/65 px-2.5 py-2 text-[12px] leading-snug text-text-main shadow-sm backdrop-blur-sm whitespace-pre-wrap">
                    {displaySuggestion}
                  </p>
                  <div className="rounded-lg border border-white/60 bg-white/75 px-2 py-2.5 text-center shadow-sm backdrop-blur-sm">
                    <div className="text-[10px] font-semibold text-text-secondary">
                      封面大字（随 json:cover 生图写入画面，可改后点确认生成）
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
                  {coverImageFile
                    ? '已选照片作底图，确认后将走图生图（大字由 API 绘入成图）'
                    : '可先上传照片作底图；成图仅经生图 API，客户端不合字'}
                </div>
              </div>
            </>
          ) : (
            <div className="flex w-full flex-col gap-2 p-1">
              <div className="flex w-full justify-center">
                <img
                  src={cover.imageUrl}
                  alt="封面预览"
                  className="block h-auto max-h-[min(85vh,640px)] w-auto max-w-full rounded-lg"
                />
              </div>
              {canEdit ? (
                <div className="px-0.5">
                  <label className="mb-1 block text-[10px] font-semibold text-text-secondary">
                    封面大字（发送给生图 API，由模型绘入成图）
                  </label>
                  <input
                    value={cover.overlayText}
                    onChange={(e) => {
                      setCover((c) => ({ ...c, overlayText: e.target.value }))
                      recordEdit()
                    }}
                    placeholder="可据标题由模型生成，或自行填写"
                    className="w-full rounded-lg border border-border-muted bg-surface px-2.5 py-2 text-[13px] font-semibold text-text-main outline-none focus:border-primary/40"
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-border-muted bg-surface/80 px-2.5 py-2 text-center text-[12px] font-semibold text-text-main">
                  {cover.overlayText || '—'}
                </div>
              )}
            </div>
          )}
        </div>

        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <label className="cursor-pointer rounded-lg border border-border-muted bg-surface px-3 py-1.5 text-[11px] font-semibold text-text-main transition-colors hover:border-primary/40 hover:text-primary">
              {hasDisplayImage ? '更换照片' : '上传照片'}
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
              disabled={!canDownloadCover}
              onClick={() => void handleDownloadCover()}
              className="rounded-lg border border-border-muted bg-surface px-3 py-1.5 text-[11px] font-semibold text-text-main transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              下载封面
            </button>
          </div>
        ) : null}

        {canEdit && hasDraft && draftHasTextForCover && onRequestCoverGeneration ? (
          <div className="rounded-xl border border-primary/25 bg-gradient-to-br from-primary/5 to-canvas px-3 py-2.5">
            <div className="text-[11px] font-bold text-text-secondary">封面生图</div>
            <p className="mt-1 text-[11px] leading-snug text-text-secondary">
              左侧为画面建议与原图/成图预览；确认后向助手发送请求并输出 json:cover，大字由生图写入画面。
            </p>
            {coverImageFile ? (
              <p className="mt-1 text-[10px] font-medium text-primary">已上传底图：将以该图为 img2img 底图</p>
            ) : (
              <p className="mt-1 text-[10px] text-text-tertiary">未上传照片时为文生图；先上传可用作底图</p>
            )}
            <button
              type="button"
              disabled={gatewayDisconnected || coverGenSubmitting}
              onClick={() => void handleConfirmCoverGen()}
              className="mt-2.5 w-full rounded-lg bg-primary px-3 py-2 text-center text-[12px] font-bold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {coverGenSubmitting ? '生成中，请稍候…' : '确认生成封面'}
            </button>
            {gatewayDisconnected ? (
              <p className="mt-1 text-[10px] text-amber-700">网关未连接，无法请求生图</p>
            ) : null}
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

  const draftBodyPreview = body

  const aiSuggestionItems = useMemo(() => {
    const sug = qualityScore?.suggestions ?? []
    const lineCount = Math.max(body.split('\n').length, 1)
    const n = lineCount
    return sug.map((text, i) => ({
      id: `ai-sug-${i}`,
      paragraphIndex: i % n,
      text,
      applied: !!appliedSuggestionIds[`ai-sug-${i}`],
    }))
  }, [qualityScore, body, appliedSuggestionIds])

  function applyAiSuggestion(id: string, paragraphIndex: number, text: string) {
    if (stage >= 4) return
    const lines = body.split('\n')
    if (paragraphIndex >= 0 && paragraphIndex < lines.length) {
      lines[paragraphIndex] = text
      setBody(lines.join('\n'))
    } else {
      setBody((prev) => (prev.trim() ? `${prev}\n\n${text}` : text))
    }
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

          {/* Body：整块可编辑 */}
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-text-secondary">正文</div>
            <div
              className={
                bodyModified
                  ? 'border-l-[3px] border-l-emerald-500 pl-2'
                  : 'border-l-[3px] border-l-[#e5e7eb] pl-2'
              }
              style={{ touchAction: 'pan-y' }}
            >
              <textarea
                value={body}
                onChange={(e) => {
                  if (isReadOnly) return
                  setBody(e.target.value)
                  recordEdit()
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
                readOnly={isReadOnly}
                placeholder="写正文…（可随意换行、增删）"
                rows={10}
                className="min-h-[200px] w-full resize-y rounded-md bg-transparent py-1 text-[13px] leading-[1.5] text-text-main outline-none placeholder:text-text-secondary/70"
              />
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
                  {portfolioSaveCount > 0 && progressToNext === 0 ? (
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
                      portfolioSaveCount > 0 && progressToNext === 0
                        ? '#22c55e'
                        : 'rgba(255, 36, 66, 0.2)',
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

