/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useRef, useState } from 'react'
import DemoChatPanel, { type ChatMessage, type TopicCardModel } from '../components/DemoChatPanel'
import XhsPostEditor, {
  type Draft,
  type EditorStage,
  type OriginalityReport,
  type QualityScore,
} from '../components/XhsPostEditor'
import { useActiveAccount } from '../contexts/ActiveAccountContext'
import { addMaterial, clearDraftSession, loadDraftSession } from '../lib/ideashuStorage'
import { createOpenClawClient, type TrendSignal } from '../lib/openclawClient'

const sharedOpenclaw = createOpenClawClient({
  url: 'ws://127.0.0.1:18789/',
  connectTimeoutMs: 30000,
})

const globalAny = globalThis as unknown as Record<string, unknown>

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
  const openclaw = sharedOpenclaw
  const { activeAccount } = useActiveAccount()

  const [topicCards, setTopicCards] = useState<TopicCardModel[]>([])
  const [gatewayReady, setGatewayReady] = useState(false)
  const [connectAttempted, setConnectAttempted] = useState(false)

  const [loadedDraft, setLoadedDraft] = useState<Draft | undefined>(undefined)
  const [originalDraft, setOriginalDraft] = useState<Draft | undefined>(undefined)
  const [qualityScore, setQualityScore] = useState<QualityScore | undefined>(undefined)
  const [originalityReport, setOriginalityReport] = useState<OriginalityReport | undefined>(undefined)

  const currentDraftRef = useRef<Draft | undefined>(undefined)
  const suppressNextDraftRef = useRef(false)

  const connectPromiseRef = useRef<Promise<void> | null>(null)
  const msgId = useRef(1)
  const nextMsgId = () => `msg-${msgId.current++}`

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const replyIdToMsgIdRef = useRef<Map<string, string>>(new Map())

  const editorStage = useMemo(
    () => deriveEditorStage(loadedDraft, qualityScore),
    [loadedDraft, qualityScore],
  )

  function ensureConnected() {
    const gKey = '__ideashu_openclaw_connectPromise'
    const gExisting = globalAny[gKey] as Promise<void> | undefined
    if (gExisting) return gExisting

    if (connectPromiseRef.current) return connectPromiseRef.current

    const p = openclaw.connect().finally(() => {
      connectPromiseRef.current = null
      globalAny[gKey] = null
    })

    connectPromiseRef.current = p
    globalAny[gKey] = p
    return p
  }

  useEffect(() => {
    const unsub = openclaw.onConnectionChange((ready) => {
      setGatewayReady(ready)
    })
    return unsub
  }, [openclaw])

  useEffect(() => {
    ensureConnected().finally(() => setConnectAttempted(true))
  }, [])

  // Restore the last unfinished editor session when re-entering the workspace.
  useEffect(() => {
    const session = loadDraftSession()
    if (!session) return
    setLoadedDraft(session.draft)
    setOriginalDraft(session.originalDraft)
  }, [])

  function resetDraftSession() {
    suppressNextDraftRef.current = true
    clearDraftSession()
    currentDraftRef.current = undefined
    setLoadedDraft(undefined)
    setOriginalDraft(undefined)
    setQualityScore(undefined)
    setOriginalityReport(undefined)
  }

  useEffect(() => {
    const unsubscribe = openclaw.onEvent((evt) => {
      if (evt.type === 'assistant_reply') {
        const text = evt.text
        const replyId = evt.replyId
        setMessages((prev) => {
          const existingMsgId = replyIdToMsgIdRef.current.get(replyId)
          if (existingMsgId) {
            const existing = prev.find((m) => m.id === existingMsgId)
            if (!existing) return prev
            if (
              existing.content === text ||
              normalizeAgentBubbleText(existing.content) === normalizeAgentBubbleText(text)
            ) {
              return prev
            }
            return prev.map((m) => (m.id === existingMsgId ? { ...m, content: text } : m))
          }

          const newId = nextMsgId()
          replyIdToMsgIdRef.current.set(replyId, newId)
          return [...prev, { id: newId, role: 'agent', content: text }]
        })
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
        const finalized = evt.draft.status === 'finalized'

        if (finalized) {
          setLoadedDraft(evt.draft)
          setOriginalDraft((prev) => prev ?? evt.draft)
          return
        }

        if (!draftHasMeaningfulContent(evt.draft)) return

        setLoadedDraft(evt.draft)
        setOriginalDraft((prev) => prev ?? evt.draft)
        setQualityScore(undefined)
        setOriginalityReport(undefined)
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

  async function handleSend(text: string, options?: { imageDataUrl?: string }) {
    const trimmed = text.trim()
    if (!trimmed && !options?.imageDataUrl) return

    setTopicCards([])
    replyIdToMsgIdRef.current.clear()

    let wireText = trimmed
    if (options?.imageDataUrl) {
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
      await ensureConnected()
      if (!openclaw.isReady()) return
      openclaw.send(wireText)
    } finally {
      setSending(false)
    }
  }

  function handleSubmitQuality() {
    handleSend('继续')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas px-3 py-2 md:px-4 md:py-2">
      <div className="flex min-h-0 w-full flex-1 gap-3 overflow-hidden md:flex-row md:gap-4">
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
            onSubmitQuality={handleSubmitQuality}
            onResetDraftSession={resetDraftSession}
            gatewayDisconnected={connectAttempted && !gatewayReady}
          />
        </section>
      </div>
    </div>
  )
}
