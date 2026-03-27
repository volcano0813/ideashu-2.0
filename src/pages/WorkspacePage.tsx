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
import { addMaterial, clearDraftSession, consumePendingDraft, loadDraftSession } from '../lib/ideashuStorage'
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
  if (qualityScore !== undefined) return 3
  if (loadedDraft && draftHasMeaningfulContent(loadedDraft)) return 2
  return 1
}

export default function WorkspacePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const openclaw = sharedOpenclaw
  const { activeAccount, patchActiveAccount, accounts, upsertAccountProfile, addAccount } =
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
    clearDraftSession()
    currentDraftRef.current = undefined
    lastLocalImageDataUrlRef.current = null
    setLoadedDraft(undefined)
    setOriginalDraft(undefined)
    setQualityScore(undefined)
    setOriginalityReport(undefined)
  }

  useLayoutEffect(() => {
    function applyAssistantReply(evt: { replyId: string; text: string }) {
      const text = evt.text
      syncAccountsFromAssistantText(text)
      const replyId = evt.replyId
      setMessages((prev) => {
        const existingMsgId = replyIdToMsgIdRef.current.get(replyId)
        if (existingMsgId) {
          const existing = prev.find((m) => m.id === existingMsgId)
          if (existing) {
            if (
              existing.content === text ||
              normalizeAgentBubbleText(existing.content) === normalizeAgentBubbleText(text)
            ) {
              return prev
            }
            return prev.map((m) => (m.id === existingMsgId ? { ...m, content: text } : m))
          }
          replyIdToMsgIdRef.current.delete(replyId)
        }

        if (
          prev.some(
            (m) =>
              m.role === 'agent' &&
              normalizeAgentBubbleText(m.content) === normalizeAgentBubbleText(text),
          )
        ) {
          return prev
        }

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
        setTopicCards(trendSignalsToTopicCards(evt.topics))
        return
      }

      if (evt.type === 'draft') {
        if (suppressNextDraftRef.current) {
          suppressNextDraftRef.current = false
          return
        }
        const localImg = lastLocalImageDataUrlRef.current
        const evtDraft = evt.draft
        const injectedDraft =
          localImg && !evtDraft.cover.imageUrl
            ? {
                ...evtDraft,
                cover: {
                  ...evtDraft.cover,
                  imageUrl: localImg,
                  // Ensure the cover slot shows an image rather than "文字封面".
                  type: evtDraft.cover.type === 'text' ? 'photo' : evtDraft.cover.type,
                },
              }
            : evtDraft

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
        // After quality scoring starts, cover injection is no longer needed.
        lastLocalImageDataUrlRef.current = null
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
    options?: { imageDataUrl?: string; skipMaterialSave?: boolean },
  ) {
    const trimmed = text.trim()
    if (!trimmed && !options?.imageDataUrl) return

    // Keep the latest attached image for potential cover-image injection.
    lastLocalImageDataUrlRef.current = options?.imageDataUrl ?? null

    setTopicCards([])
    replyIdToMsgIdRef.current.clear()

    let wireText = trimmed
    if (options?.imageDataUrl && !options.skipMaterialSave) {
      const mat = addMaterial({
        type: 'photo',
        content: trimmed || '图片素材（聊天附带）',
        imageDataUrl: options.imageDataUrl,
        topicTags: ['聊天附带'],
      })
      wireText = trimmed
        ? `${trimmed}\n\n【本地素材库已保存图片：${mat.id}】（网关仅传输文字；画面已写入本机「素材银行」）`
        : `【本地素材库已保存图片：${mat.id}】请结合我上传的画面继续引导。（网关仅传输文字；画面已写入本机「素材银行」）`
    }

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

  // 灵感库 route state：自动发「帮我改」；否则 pending 草稿 / 本地会话恢复
  useEffect(() => {
    const st = location.state as WorkspaceLocationState | undefined
    if (st?.autoMessage) {
      const dedupeKey = st.nonce ?? st.sourceMaterialId ?? st.autoMessage
      if (handledWorkspaceAutoNonces.has(dedupeKey)) return
      handledWorkspaceAutoNonces.add(dedupeKey)

      clearDraftSession()
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
      return
    }

    const pending = consumePendingDraft()
    if (pending && draftHasMeaningfulContent(pending)) {
      setLoadedDraft(pending)
      setOriginalDraft(pending)
      setQualityScore(undefined)
      setOriginalityReport(undefined)
      return
    }
    const session = loadDraftSession()
    if (!session) return
    setLoadedDraft(session.draft)
    setOriginalDraft(session.originalDraft)
  }, [])

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
          />
        </section>
      </div>
    </div>
  )
}
