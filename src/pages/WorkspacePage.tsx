/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import DemoChatPanel, { type ChatMessage, type TopicCardModel } from '../components/DemoChatPanel'
import XhsPostEditor, {
  type Draft,
  type EditorStage,
  type OriginalityReport,
  type QualityScore,
} from '../components/XhsPostEditor'
import { useActiveAccount, type AccountProfileInput } from '../contexts/ActiveAccountContext'
import { stripAccountNameAsterisks } from '../lib/accounts'
import { addMaterial, clearDraftSession, consumePendingDraft, loadDraftSession, peekPendingDraft } from '../lib/ideashuStorage'
import type { WorkspaceLocationState } from '../lib/workspaceLocationState'
import { ensureOpenClawConnected, openclaw as sharedOpenclaw } from '../lib/openclawSingleton'
import { type TrendSignal } from '../lib/openclawClient'
import { useIdeashuSync } from '../hooks/useIdeashuSync'

const handledWorkspaceAutoNonces = new Set<string>()

function draftHasMeaningfulContent(d: Draft): boolean {
  return !!(d.title.trim() || d.body.trim())
}

function normalizeAgentBubbleText(s: string) {
  return s.replace(/\s+/g, ' ').trim()
}

function isTopicsMachinePayload(text: string): boolean {
  const s = (text ?? '').trim()
  if (!s) return false
  return /```json:topics\b/i.test(s) || /\bjson:topics\b/i.test(s)
}

/**
 * 修复 Skill 返回的"一句一行"格式。
 * 只合并明显的"诗歌格式"（段内连续 3+ 行都是短句），保留有意的短段落。
 */
function mergeShortLinesToParagraphs(body: string): string {
  if (!body) return body
  // 按段落分隔（两个及以上换行）
  const paragraphs = body.split(/\n{2,}/)

  const merged = paragraphs.map((para) => {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length <= 2) return lines.join('\n')

    // 检测连续短行（<25字）的段落——这是典型的"一句一行"
    const shortLines = lines.filter((l) => l.length < 25)
    // 只有超过 70% 的行都是短句，且连续短行 >= 3，才认为需要合并
    if (shortLines.length < lines.length * 0.7 || lines.length < 3) {
      return lines.join('\n')
    }

    // 合并短行，但遇到语义转折点时分段
    const groups: string[][] = [[]]
    for (const line of lines) {
      const currentGroup = groups[groups.length - 1]!
      // 如果当前组已经有 3-4 句了，开新段
      if (currentGroup.length >= 4) {
        groups.push([line])
      } else {
        currentGroup.push(line)
      }
    }

    return groups
      .map((group) => {
        if (group.length <= 1) return group.join('')
        let result = group[0] ?? ''
        for (let i = 1; i < group.length; i++) {
          const lastChar = result[result.length - 1] ?? ''
          const curr = group[i] ?? ''
          if (/[。！？；…""''）》\.\!\?\;\)\>]/.test(lastChar)) {
            result = result + curr
          } else if (/[，、：,\:]/.test(lastChar)) {
            result = result + curr
          } else {
            result = result + '，' + curr
          }
        }
        return result
      })
      .join('\n\n')
  })

  return merged.join('\n\n')
}

function trendSignalsToTopicCards(topics: TrendSignal[]): TopicCardModel[] {
  return topics.map((t) => {
    const desc =
      [t.angle, t.topicSource ?? t.sources[0]?.metrics].filter(Boolean).join(' · ').slice(0, 120) ||
      t.title
    return {
      id: t.id,
      title: t.title,
      description: desc,
      recommended: t.materialMatch === true,
    }
  })
}

function demoQualityScore(): QualityScore {
  return {
    hook: 72,
    authentic: 74,
    aiSmell: 38,
    diversity: 70,
    cta: 73,
    platform: 76,
    suggestions: [
      '第2段可加入一个具体时间点（如「下午4点」），让场景更可感。',
      '标题可加入一个情绪词，与正文语气更一致。',
      '结尾可加一句轻量互动提问，提升评论率。',
    ],
  }
}

/** Editor chrome only: empty → has draft → has score panel → finalized (all from parsed JSON, not “stage” UX). */
function deriveEditorStage(
  loadedDraft: Draft | undefined,
  qualityScore: QualityScore | undefined,
): EditorStage {
  if (loadedDraft?.status === 'finalized') return 4
  const hasDraft = !!(loadedDraft && draftHasMeaningfulContent(loadedDraft))
  // 必须先识别「有正文草稿」再进质检态，否则仅有残留的 qualityScore 会让 stage=3，
  // XhsPostEditor 只在 stage 2 做整表 hydrate，表现为「跳回工作台但编辑器空白」。
  if (hasDraft) {
    if (qualityScore !== undefined) return 3
    return 2
  }
  if (qualityScore !== undefined) return 3
  return 1
}

export default function WorkspacePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const openclaw = sharedOpenclaw
  const { activeAccount, activeAccountId, patchActiveAccount, accounts, upsertAccountProfile, addAccount } =
    useActiveAccount()

  const syncedAccountNamesRef = useRef<Set<string>>(new Set())

  function stripMarkdownDecorations(raw: string): string {
    let s = stripAccountNameAsterisks(raw ?? '')
    s = s.replace(/^`+/, '').replace(/`+$/, '').trim()
    return s
  }

  function splitCatchPhrases(s: string): string[] {
    return s
      .replace(/[；;]/g, '、')
      .replace(/[，,]/g, '、')
      .split(/[、/|]/g)
      .map((x) => x.trim())
      .filter(Boolean)
  }

  function normalizeHeaderKey(raw: string) {
    const k = raw.replace(/\s+/g, '').trim()
    if (k.includes('账号')) return 'name'
    if (k.includes('领域')) return 'domain'
    if (k.includes('人设')) return 'persona'
    if (k.includes('调性') || k.includes('语气')) return 'tone'
    if (k.includes('口头禅') || k.includes('常用句')) return 'catchPhrases'
    if (k.includes('风格')) return 'styleName'
    return null
  }

  function extractAccountProfilesFromAssistantText(text: string): AccountProfileInput[] {
    const s = (text ?? '').replace(/\r\n/g, '\n')
    if (!s.trim()) return []

    // Strong gate: only attempt when the message is very likely about account configuration.
    const gate =
      /账号配置|已有配置|新建账号|账号\s*清单|账号\s*列表|领域|状态|人设|调性|口头禅|常用句|风格/.test(s) &&
      /账号/.test(s)
    if (!gate) return []

    const lines = s
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)

    const out: AccountProfileInput[] = []

    // A) Markdown table: map headers -> cells.
    const headerIdx = lines.findIndex((l) => l.includes('|') && l.includes('账号'))
    if (headerIdx >= 0) {
      const headerCells = lines[headerIdx]!
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean)
      const headerKeys = headerCells.map((c) => normalizeHeaderKey(c))

      for (let i = headerIdx + 1; i < Math.min(lines.length, headerIdx + 20); i++) {
        const l = lines[i]!
        if (!l.includes('|')) continue
        if (/---/.test(l)) continue
        const cells = l.split('|').map((c) => c.trim()).filter(Boolean)
        if (cells.length === 0) continue
        const name = cells[0]?.trim()
        if (!name) continue

        const p: AccountProfileInput = { name }
        for (let ci = 0; ci < Math.min(cells.length, headerKeys.length); ci++) {
          const key = headerKeys[ci]
          const val = cells[ci]
          if (!key || !val) continue
          if (key === 'catchPhrases') p.catchPhrases = splitCatchPhrases(val)
          else (p as any)[key] = val
        }
        out.push(p)
      }
    }

    // B) Field blocks: "账号：xxx" then other fields.
    const blocks = s.split(/\n(?=账号[:：])/g)
    for (const b of blocks) {
      const mName = b.match(/账号[:：]\s*([^\n，。]{2,40})/)
      if (!mName?.[1]) continue
      const p: AccountProfileInput = { name: mName[1].trim() }
      const mDomain = b.match(/领域[:：]\s*([^\n]{2,80})/)
      const mPersona = b.match(/人设[:：]\s*([^\n]{2,160})/)
      const mTone = b.match(/调性[:：]\s*([^\n]{2,160})/)
      const mStyle = b.match(/风格[:：]\s*([^\n]{2,160})/)
      const mCatch = b.match(/(口头禅|常用句)[:：]\s*([^\n]{2,200})/)
      if (mDomain?.[1]) p.domain = mDomain[1].trim()
      if (mPersona?.[1]) p.persona = mPersona[1].trim()
      if (mTone?.[1]) p.tone = mTone[1].trim()
      if (mStyle?.[1]) p.styleName = mStyle[1].trim()
      if (mCatch?.[2]) p.catchPhrases = splitCatchPhrases(mCatch[2].trim())
      out.push(p)
    }

    // C) Plain aligned table: "序号 账号名 领域 创建时间" then rows.
    const plainNameHeaderIdx = lines.findIndex(
      (l) =>
        !l.includes('|') &&
        /账号名/.test(l.replace(/\s+/g, '')) &&
        /领域/.test(l.replace(/\s+/g, '')) &&
        /(创建时间|时间)/.test(l.replace(/\s+/g, '')),
    )
    if (plainNameHeaderIdx >= 0) {
      for (let i = plainNameHeaderIdx + 1; i < Math.min(lines.length, plainNameHeaderIdx + 20); i++) {
        const l = lines[i]!
        if (/^[-—_]{3,}$/.test(l)) continue
        if (/请选择|回复\s*[A-E]/.test(l)) break
        // Typical row: "2 Elia的AI实践 AI工具与产品实践 20:02"
        // - first token: index
        // - second token: name
        // - last token: time-like
        const tokens = l.split(/\s+/g).filter(Boolean)
        if (tokens.length < 3) continue
        if (!/^\d+$/.test(tokens[0]!)) continue
        const name = tokens[1]!.trim()
        if (!name) continue
        // Domain is everything between name and last token.
        const last = tokens[tokens.length - 1]!
        const domainRaw = tokens.slice(2, -1).join(' ').trim()
        const domain = domainRaw || undefined
        // Require last token looks like time; otherwise keep parsing but still allow.
        const looksTime = /^\d{1,2}:\d{2}$/.test(last) || /^\d{4}-\d{2}-\d{2}/.test(last)
        const p: AccountProfileInput = { name }
        if (domain) p.domain = domain
        if (looksTime) {
          // no-op for now; time isn't stored in Account model.
        }
        out.push(p)
      }
    }

    // De-dupe by name, merging fields (table + blocks).
    const merged = new Map<string, AccountProfileInput>()
    for (const p of out) {
      const name = stripMarkdownDecorations(p.name)
      if (!name) continue
      const prev = merged.get(name)
      merged.set(name, { ...(prev ?? { name }), ...p, name })
    }
    return [...merged.values()]
  }

  function extractAccountNamesFromAssistantText(text: string): string[] {
    const s = (text ?? '').replace(/\r\n/g, '\n')
    if (!s.trim()) return []

    // Strong gate: only attempt when the message is very likely about account configuration.
    const gate =
      /账号配置|已有配置|新建账号|账号\s*清单|账号\s*列表|领域|状态/.test(s) && /账号/.test(s)
    if (!gate) return []

    const out: string[] = []
    const push = (name: string) => {
      const n = stripMarkdownDecorations(name)
      if (n.length < 2) return
      if (['账号', '领域', '状态', '完成', '已有配置'].includes(n)) return
      out.push(n)
    }

    const lines = s
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)

    // 1) Markdown table: lines containing pipes.
    const headerIdx = lines.findIndex((l) => l.includes('|') && l.includes('账号') && l.includes('领域'))
    if (headerIdx >= 0) {
      for (let i = headerIdx + 1; i < Math.min(lines.length, headerIdx + 12); i++) {
        const l = lines[i]!
        if (!l.includes('|')) continue
        if (/---/.test(l)) continue
        const cells = l.split('|').map((c) => c.trim()).filter((c) => c.length > 0)
        const nameCell = cells[0]
        if (nameCell) push(nameCell)
      }
    }

    // 2) Plain text rows: a "账号 领域 状态" header then rows below.
    const plainHeaderIdx = lines.findIndex(
      (l) => !l.includes('|') && /账号/.test(l) && /领域/.test(l) && /状态/.test(l),
    )
    if (plainHeaderIdx >= 0) {
      for (let i = plainHeaderIdx + 1; i < Math.min(lines.length, plainHeaderIdx + 12); i++) {
        const l = lines[i]!
        if (/^[-—_]{3,}$/.test(l)) continue
        if (/配置完成|已有配置|检测到重复指令/.test(l)) continue
        // Example: "Elia的AI实践 AI工具与产品实践 ✅ 20:02 完成"
        const m = l.match(/^(\S{2,40})\s+/)
        if (m?.[1]) push(m[1])
      }
    }

    // 3) Fallback: "账号：xxx"
    const re = /账号[:：]\s*([^\n，。]{2,40})/g
    let m: RegExpExecArray | null
    while ((m = re.exec(s)) !== null) {
      push(m[1] ?? '')
    }

    return [...new Set(out)]
  }

  function syncAccountsFromAssistantText(text: string) {
    const profiles = extractAccountProfilesFromAssistantText(text)
    const existingNames = new Set(accounts.map((a) => stripMarkdownDecorations(a.name)))

    if (profiles.length > 0) {
      for (const p of profiles) {
        const name = stripMarkdownDecorations(p.name)
        if (!name) continue
        // Prevent repeated writes on the same assistant bubble updates.
        if (syncedAccountNamesRef.current.has(name)) continue
        syncedAccountNamesRef.current.add(name)
        upsertAccountProfile({ ...p, name })
      }
      return
    }

    // Fallback: still support name-only extraction.
    const names = extractAccountNamesFromAssistantText(text)
    for (const name of names) {
      if (existingNames.has(name)) continue
      if (syncedAccountNamesRef.current.has(name)) continue
      syncedAccountNamesRef.current.add(name)
      addAccount(name)
    }
  }

  const [topicCards, setTopicCards] = useState<TopicCardModel[]>([])
  const [gatewayReady, setGatewayReady] = useState(false)
  const [connectAttempted, setConnectAttempted] = useState(false)

  const [loadedDraft, setLoadedDraft] = useState<Draft | undefined>(undefined)
  const [originalDraft, setOriginalDraft] = useState<Draft | undefined>(undefined)
  const [qualityScore, setQualityScore] = useState<QualityScore | undefined>(undefined)
  const [originalityReport, setOriginalityReport] = useState<OriginalityReport | undefined>(undefined)

  // ===== IdeaShu Sync 集成 =====
  // 用于同步飞书对话内容到前端
  const { 
    isConnected: syncConnected, 
    drafts: syncDrafts,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    latestDraft: _syncLatestDraft,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    topics: _syncTopics 
  } = useIdeashuSync({
    userId: 'default',
    onDraftUpdate: (draft) => {
      console.log('[Sync] Received draft from sync server:', draft.title)
    },
    onTopicsUpdate: (topics) => {
      console.log('[Sync] Received topics from sync server:', topics.length)
    },
    onConnect: () => {
      console.log('[Sync] Connected to sync server')
    },
    onDisconnect: () => {
      console.log('[Sync] Disconnected from sync server')
    },
  })

  const currentDraftRef = useRef<Draft | undefined>(undefined)
  const suppressNextDraftRef = useRef(false)
  // 标记当前回复轮次是否已收到 draft 事件，用于屏蔽同轮的 topics
  const hasDraftInCurrentRoundRef = useRef(false)
  // Gateway/assistant may only return text; if the user attached an image in chat,
  // we inject it into the editor's cover slot by setting `draft.cover.imageUrl`.
  const lastLocalImageDataUrlRef = useRef<string | null>(null)

  const msgId = useRef(1)
  const nextMsgId = () => `msg-${msgId.current++}`

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const replyIdToMsgIdRef = useRef<Map<string, string>>(new Map())

  const editorStage = useMemo(
    () => deriveEditorStage(loadedDraft, qualityScore),
    [loadedDraft, qualityScore],
  )

  useEffect(() => {
    const unsub = openclaw.onConnectionChange((ready) => {
      setGatewayReady(ready)
    })
    return unsub
  }, [openclaw])

  useEffect(() => {
    ensureOpenClawConnected().finally(() => setConnectAttempted(true))
  }, [])

  function resetDraftSession() {
    suppressNextDraftRef.current = true
    clearDraftSession(activeAccountId)
    currentDraftRef.current = undefined
    lastLocalImageDataUrlRef.current = null
    setLoadedDraft(undefined)
    setOriginalDraft(undefined)
    setQualityScore(undefined)
    setOriginalityReport(undefined)
  }

  // 必须在 OpenClaw 的 layout 订阅之前恢复草稿，否则残留的 score 事件会把 editorStage 顶到 3，
  // 而编辑器只在 stage 2 灌入正文，表现为「跳回工作台无反应」。
  useLayoutEffect(() => {
    const st = location.state as WorkspaceLocationState | undefined
    if (st?.autoMessage) return

    let consumePendingCancelled = false

    currentDraftRef.current = undefined
    lastLocalImageDataUrlRef.current = null
    setLoadedDraft(undefined)
    setOriginalDraft(undefined)
    setQualityScore(undefined)
    setOriginalityReport(undefined)

    const pending = peekPendingDraft(activeAccountId)
    if (pending && draftHasMeaningfulContent(pending)) {
      setLoadedDraft(pending)
      setOriginalDraft(pending)
      setQualityScore(undefined)
      setOriginalityReport(undefined)
      queueMicrotask(() => {
        if (!consumePendingCancelled) consumePendingDraft(activeAccountId)
      })
    } else {
      const session = loadDraftSession(activeAccountId)
      if (session) {
        setLoadedDraft(session.draft)
        setOriginalDraft(session.originalDraft)
      }
    }

    return () => {
      consumePendingCancelled = true
    }
  }, [activeAccountId, location.key, navigate])

  useLayoutEffect(() => {
    /** 判断助手正文是否应清空选题卡片（与卡片互斥展示） */
    function assistantTextClearsTopicCards(text: string): boolean {
      const trimmed = (text ?? '').trim()
      if (!trimmed) return false
      // 纯机器占位句不与选题卡片竞争
      const norm = trimmed.replace(/\s+/g, ' ')
      if (norm === '已生成结果（草稿/评分/原创度已更新）。') return false
      return true
    }

    /** 检测 TrendSignal 是否为账号配置引导的误解析 */
    function isAccountSetupFalsePositive(t: TrendSignal): boolean {
      const title = (t.title ?? '').toLowerCase()
      return /账号名|账号叫|内容领域|领域定位|阶段零|account\s*name|填空|什么名字|什么领域/.test(title)
    }

    function applyAssistantReply(evt: { replyId: string; text: string }) {
      const text = evt.text
      const isTopicsPayload = isTopicsMachinePayload(text)
      syncAccountsFromAssistantText(text)
      const replyId = evt.replyId

      // 有实质正文时，清空选题卡片（对话气泡与选题卡片互斥）
      if (!isTopicsPayload && assistantTextClearsTopicCards(text)) {
        setTopicCards([])
      }

      setMessages((prev) => {
        // Topics 机器载荷由选题卡片渲染，不进对话气泡
        if (isTopicsPayload) return prev

        const textNorm = normalizeAgentBubbleText(text)

        // 1. 同一 replyId 的消息 → 直接更新内容
        const existingMsgId = replyIdToMsgIdRef.current.get(replyId)
        if (existingMsgId) {
          const existing = prev.find((m) => m.id === existingMsgId)
          if (existing) {
            if (normalizeAgentBubbleText(existing.content) === textNorm) return prev
            return prev.map((m) => (m.id === existingMsgId ? { ...m, content: text } : m))
          }
        }

        // 2. 流式场景：新文本是某条已有助手消息的"更长版本"（包含它的内容）→ 更新那条
        const supersetIdx = prev.findIndex(
          (m) => m.role === 'agent' && textNorm.length > 0 &&
            normalizeAgentBubbleText(m.content).length > 0 &&
            (textNorm.includes(normalizeAgentBubbleText(m.content)) ||
             normalizeAgentBubbleText(m.content).includes(textNorm))
        )
        if (supersetIdx >= 0) {
          const target = prev[supersetIdx]!
          // 保留更长的那个
          const existingNorm = normalizeAgentBubbleText(target.content)
          if (textNorm.length >= existingNorm.length) {
            replyIdToMsgIdRef.current.set(replyId, target.id)
            return prev.map((m, i) => (i === supersetIdx ? { ...m, content: text } : m))
          }
          return prev
        }

        // 3. 完全相同内容 → 跳过
        if (prev.some((m) => m.role === 'agent' && normalizeAgentBubbleText(m.content) === textNorm)) {
          return prev
        }

        // 4. 新消息
        const newId = nextMsgId()
        replyIdToMsgIdRef.current.set(replyId, newId)
        return [...prev, { id: newId, role: 'agent', content: text }]
      })
    }

    const unsubscribe = openclaw.onEvent((evt) => {
      if (evt.type === 'assistant_reply') {
        applyAssistantReply(evt)
        return
      }

      if (evt.type === 'topics') {
        // 如果编辑器已有草稿，或本轮已收到过 draft 事件，忽略 topics
        if (hasDraftInCurrentRoundRef.current) return
        if (currentDraftRef.current && draftHasMeaningfulContent(currentDraftRef.current)) {
          return
        }
        // 过滤假选题：
        // 1. 真正的选题至少有 angle 或 heatScore 或 sourceUrl
        // 2. 排除账号配置引导类的误解析（标题含"账号名""领域"等关键词）
        const validTopics = (evt.topics ?? []).filter(
          (t: TrendSignal) =>
            !isAccountSetupFalsePositive(t) &&
            ((t.angle && t.angle.length > 0) ||
             (t.heatScore != null && t.heatScore > 0) ||
             (t.sourceUrl && t.sourceUrl.length > 0))
        )
        if (validTopics.length === 0) return
        setTopicCards(trendSignalsToTopicCards(validTopics))
        return
      }

      if (evt.type === 'draft') {
        if (suppressNextDraftRef.current) {
          suppressNextDraftRef.current = false
          return
        }
        // 标记本轮已收到 draft，屏蔽后续 topics
        hasDraftInCurrentRoundRef.current = true
        // 收到草稿后立即清空选题卡片
        setTopicCards([])

        const evtDraft = evt.draft

        // 修复 Skill 返回的"一句一行"格式，合并为自然段落
        const fixedDraft = {
          ...evtDraft,
          body: mergeShortLinesToParagraphs(evtDraft.body),
        }

        // 封面图注入逻辑：
        // 1. 如果 Skill 返回了 cover.imageUrl（来自 SiliconFlow 生图），使用 Skill 的
        // 2. 如果 Skill 没返回 imageUrl 但用户上传了图片，注入用户的图片
        // 3. 都没有则保持 Skill 返回的封面描述
        const skillHasCoverImage = fixedDraft.cover?.imageUrl && fixedDraft.cover.imageUrl.length > 0
        const localImg = lastLocalImageDataUrlRef.current
        const injectedDraft =
          skillHasCoverImage
            ? fixedDraft  // Skill 生成了封面图，优先使用
            : localImg
              ? {
                  ...fixedDraft,
                  cover: {
                    ...fixedDraft.cover,
                    imageUrl: localImg,
                    type: 'photo' as const,
                  },
                }
              : fixedDraft

        const finalized = injectedDraft.status === 'finalized'

        if (finalized) {
          currentDraftRef.current = injectedDraft
          setLoadedDraft(injectedDraft)
          setOriginalDraft((prev) => prev ?? injectedDraft)
          return
        }

        if (!draftHasMeaningfulContent(injectedDraft)) return

        currentDraftRef.current = injectedDraft
        setLoadedDraft(injectedDraft)
        setOriginalDraft((prev) => prev ?? injectedDraft)
        setQualityScore(undefined)
        setOriginalityReport(undefined)
        return
      }

      if (evt.type === 'cover') {
        lastLocalImageDataUrlRef.current = null
        setLoadedDraft((prev) => {
          const base = currentDraftRef.current ?? prev
          if (!base) return prev
          const overlay =
            evt.cover.overlayText !== undefined && evt.cover.overlayText.trim().length > 0
              ? evt.cover.overlayText.trim()
              : base.cover.overlayText
          const merged: typeof base = {
            ...base,
            cover: {
              ...base.cover,
              imageUrl: evt.cover.imageUrl,
              overlayText: overlay,
              type: 'photo',
            },
          }
          currentDraftRef.current = merged
          return merged
        })
        return
      }

      if (evt.type === 'score') {
        setQualityScore(evt.score)
        return
      }

      if (evt.type === 'originality') {
        setOriginalityReport(evt.originality)
        return
      }
    })

    queueMicrotask(() => {
      const snap = openclaw.getLastAssistantReply()
      if (snap) applyAssistantReply(snap)
    })

    return () => {
      unsubscribe()
    }
  }, [openclaw])

  function appendUserMessage(text: string, meta?: { localImageDataUrl?: string }) {
    setMessages((prev) => [
      ...prev,
      { id: nextMsgId(), role: 'user', content: text, localImageDataUrl: meta?.localImageDataUrl },
    ])
  }

  async function handleSend(
    text: string,
    options?: { imageDataUrl?: string; skipMaterialSave?: boolean; coverImg2img?: boolean },
  ) {
    const trimmed = text.trim()
    if (!trimmed && !options?.imageDataUrl) return

    // 选方向/选素材：清空卡片 UI，但不在前端填充编辑器。
    // 发给 Skill 让它决定下一步（生成草稿、继续引导等）。
    const selectMatch = trimmed.match(/^选方向\s*(\d+)\s*[：:]/)
    if (selectMatch && topicCards.length > 0) {
      setTopicCards([])
      // 不 return，继续走下面的正常发送流程
    }

    // Keep the latest attached image for potential cover-image injection.
    lastLocalImageDataUrlRef.current = options?.imageDataUrl ?? null
    // 新一轮发送，重置 draft 标记
    hasDraftInCurrentRoundRef.current = false

    setTopicCards([])

    // 检测是否是新建账号/换账号操作——此时不应附带当前账号上下文
    const isAccountManagement = /新建账号|新建|换账号|换个账号|第一次用/.test(trimmed)

    // 新建/换账号时，清空编辑器和相关状态
    if (isAccountManagement) {
      currentDraftRef.current = undefined
      lastLocalImageDataUrlRef.current = null
      setLoadedDraft(undefined)
      setOriginalDraft(undefined)
      setQualityScore(undefined)
      setOriginalityReport(undefined)
    }

    // 在发送给网关的消息前附带当前账号信息，让 Skill 知道用户在哪个账号下操作
    // 但新建账号/换账号时不带，避免 Skill 误用当前账号的领域
    const accountContext = isAccountManagement
      ? ''
      : `【当前创作账号：${activeAccount.name}（领域：${activeAccount.domain}）】\n`

    let wireText = trimmed
    if (options?.imageDataUrl && !options.skipMaterialSave) {
      const mat = addMaterial(activeAccountId, {
        type: 'photo',
        content: trimmed || '图片素材（聊天附带）',
        imageDataUrl: options.imageDataUrl,
        topicTags: ['聊天附带'],
      })
      const coverHint = options.coverImg2img
        ? '已自动设为封面底图。请使用 **img2img** 以该图为底生成竖版封面（约 3:4）：保留场景主体与构图，将大字标题绘入画面（应用侧不做本地叠字），保持自然真实、像小红书笔记实拍，避免赛博霓虹与过度 CG。请输出 ```json:cover``` 并完成生图。'
        : '封面生成时请直接使用文生图模式生成封面，将大字标题绘入画面（应用侧不做本地叠字），倾向真实场景与轻后期、避免泛 AI 插画风，不要再问用户要图片。'
      wireText = trimmed
        ? `${trimmed}\n\n【本地素材库已保存图片：${mat.id}，${coverHint}】`
        : `【本地素材库已保存图片：${mat.id}，${coverHint}】`

      // 如果编辑器已有草稿但没有封面图，注入用户上传的图片
      // 如果草稿已有 Skill 生成的封面图（SiliconFlow），不覆盖
      if (currentDraftRef.current && draftHasMeaningfulContent(currentDraftRef.current)) {
        const existingCoverUrl = currentDraftRef.current.cover?.imageUrl
        if (!existingCoverUrl || existingCoverUrl.length === 0) {
          const updatedDraft = {
            ...currentDraftRef.current,
            cover: {
              ...currentDraftRef.current.cover,
              imageUrl: options.imageDataUrl,
              type: 'photo' as const,
            },
          }
          currentDraftRef.current = updatedDraft
          setLoadedDraft(updatedDraft)
        }
      }
    }

    // 最终发送的文本 = 账号上下文 + 用户消息
    wireText = accountContext + wireText

    appendUserMessage(trimmed || (options?.imageDataUrl ? '' : ''), {
      localImageDataUrl: options?.imageDataUrl,
    })
    setSending(true)
    try {
      await ensureOpenClawConnected()
      if (!openclaw.isReady()) return
      openclaw.send(wireText)
    } finally {
      setSending(false)
    }
  }

  // 灵感库 route state：自动发「帮我改」（草稿恢复已由上方 useLayoutEffect 处理）
  useEffect(() => {
    const st = location.state as WorkspaceLocationState | undefined
    if (!st?.autoMessage) return

    const dedupeKey = st.nonce ?? st.sourceMaterialId ?? st.autoMessage
    if (handledWorkspaceAutoNonces.has(dedupeKey)) return
    handledWorkspaceAutoNonces.add(dedupeKey)

    clearDraftSession(activeAccountId)
    currentDraftRef.current = undefined
    lastLocalImageDataUrlRef.current = null
    setLoadedDraft(undefined)
    setOriginalDraft(undefined)
    setQualityScore(undefined)
    setOriginalityReport(undefined)

    navigate('/workspace', { replace: true, state: {} })

    const img = st.materialImage ?? undefined
    if (img) lastLocalImageDataUrlRef.current = img

    void handleSend(st.autoMessage, { imageDataUrl: img, skipMaterialSave: true })
  }, [activeAccountId, location.key])

  function handleDeepQuality() {
    if (connectAttempted && gatewayReady && openclaw.isReady()) {
      void handleSend('继续')
      return
    }
    setQualityScore(demoQualityScore())
  }

  function handleRequestStyleAnalysis() {
    void handleSend('看我的修改规律')
    patchActiveAccount({
      hasAnalyzedStyle: true,
      styleAnalysisCount: (activeAccount.styleAnalysisCount ?? 0) + 1,
    })
  }

  function handleRequestCoverFromEditor(args: {
    wireMessage: string
    imageDataUrl?: string
    useUploadedImageAsCoverBase?: boolean
  }) {
    void handleSend(args.wireMessage, {
      imageDataUrl: args.imageDataUrl,
      skipMaterialSave: !args.useUploadedImageAsCoverBase,
      coverImg2img: args.useUploadedImageAsCoverBase,
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas">
      {/* 同步状态指示器 */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-surface border-b border-border-muted text-xs">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${gatewayReady ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-text-secondary">OpenClaw</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${syncConnected ? 'bg-green-500' : 'bg-yellow-500'}`} />
            <span className="text-text-secondary">飞书同步</span>
          </span>
        </div>
        {syncDrafts.length > 0 && (
          <span className="text-text-tertiary">
            已同步 {syncDrafts.length} 条草稿
          </span>
        )}
      </div>
      
      <div className="flex min-h-0 w-full flex-1 gap-3 overflow-hidden px-3 py-2 md:px-4 md:py-2 md:flex-row md:gap-4">
        <aside className="flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border-muted bg-surface md:w-[38%] md:min-w-[280px] md:max-w-[420px]">
          <DemoChatPanel
            messages={messages}
            topicCards={topicCards}
            onSend={handleSend}
            sending={sending}
            gatewayError={connectAttempted && !gatewayReady}
            accountName={activeAccount.name}
          />
        </aside>

        <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border-muted bg-surface">
          <XhsPostEditor
            stage={editorStage}
            loadedDraft={loadedDraft}
            originalDraft={originalDraft}
            originalityReport={originalityReport}
            qualityScore={qualityScore}
            onDraftChange={(draft) => {
              currentDraftRef.current = draft
            }}
            onSubmitQuality={handleDeepQuality}
            onResetDraftSession={resetDraftSession}
            gatewayDisconnected={connectAttempted && !gatewayReady}
            onRequestStyleAnalysis={handleRequestStyleAnalysis}
            onRequestCoverGeneration={handleRequestCoverFromEditor}
          />
        </section>
      </div>
    </div>
  )
}
