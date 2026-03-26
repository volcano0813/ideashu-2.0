import type { Draft, OriginalityReport, QualityScore } from '../components/XhsPostEditor'

export type TrendSignal = {
  id: string
  keyword: string
  title: string
  heatScore: number
  lifecycle: 'emerging' | 'hot' | 'peak' | 'declining'
  sources: { platform: string; url?: string; metrics?: string }[]
  suggestedAngles: string[]
  /** ideashu-v5 `json:topics` (Feishu-aligned) */
  topicSource?: string
  angle?: string
  hook?: string
  timing?: string
  timingDetail?: string
  materialMatch?: boolean
  materialCount?: number
}

export type StyleRule = {
  id: string
  category: 'word' | 'structure' | 'detail' | 'tone'
  description: string
  sourceEditIds: string[]
  enabled: boolean
  createdAt: string
}

export type OpenClawEvent =
  | { type: 'topics'; topics: TrendSignal[] }
  | { type: 'draft'; draft: Draft }
  | { type: 'score'; score: QualityScore }
  | { type: 'originality'; originality: OriginalityReport }
  | { type: 'style_rules'; rules: StyleRule[] }
  /** Natural-language part of assistant reply (```json:*``` fences removed) for chat UI. */
  | { type: 'assistant_reply'; replyId: string; text: string }

export type OpenClawClient = {
  connect: () => Promise<void>
  disconnect: () => void
  /** Plain user text to Gateway (same as Feishu client). No client-side business suffixes. */
  send: (content: string) => void
  onEvent: (cb: (evt: OpenClawEvent) => void) => () => void
  /** True when WebSocket is connected and session has a sessionKey for chat.send. */
  isReady: () => boolean
  onConnectionChange: (cb: (ready: boolean) => void) => () => void
}

function safeParseJSON(raw: string): unknown | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function stripCodeFences(s: string) {
  let out = s.trim()
  // ```json, ```json:topics, ```json:draft, etc.
  out = out.replace(/^```[\w:]*/i, '')
  out = out.replace(/```$/i, '')
  return out.trim()
}

/** Remove all Skill machine-readable ```json:tag ... ``` blocks for chat display. */
export function stripJsonFencedBlocks(text: string): string {
  return text.replace(/```json:\w+\s*[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Remove trailing bare JSON array that matches ideashu `json:topics` shape (model sometimes omits fences).
 */
function stripBareTopicsJsonArray(text: string): string {
  let trimmed = text.trimEnd()
  for (let attempt = 0; attempt < 4; attempt++) {
    const lastOpen = trimmed.lastIndexOf('[')
    if (lastOpen < 0) break
    let depth = 0
    let end = -1
    for (let i = lastOpen; i < trimmed.length; i++) {
      const c = trimmed[i]
      if (c === '[') depth++
      else if (c === ']') {
        depth--
        if (depth === 0) {
          end = i + 1
          break
        }
      }
    }
    if (end < 0) break
    const jsonCandidate = trimmed.slice(lastOpen, end)
    try {
      const parsed = JSON.parse(jsonCandidate) as unknown
      if (!Array.isArray(parsed) || parsed.length === 0) break
      const first = parsed[0]
      if (!first || typeof first !== 'object') break
      const o = first as Record<string, unknown>
      if (typeof o.title !== 'string') break
      const looksTopic =
        'id' in o ||
        'source' in o ||
        'angle' in o ||
        'hook' in o ||
        'timing' in o ||
        'materialMatch' in o
      if (!looksTopic) break
      trimmed = trimmed.slice(0, lastOpen).trimEnd()
      continue
    } catch {
      break
    }
  }
  return trimmed
}

/**
 * Chat bubble display only: strip all machine JSON (fenced + common bare arrays). Parsing still uses full `raw` in emitJsonBlocksFromBuffer.
 */
export function stripMachineJsonFromChatDisplay(text: string): string {
  let s = text
  s = s.replace(/```\s*json:\w+\s*[\s\S]*?```/gi, '')
  s = s.replace(/```\s*json\s*[\s\S]*?```/gi, '')
  s = stripBareTopicsJsonArray(s)
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Merge streaming assistant `text` chunks. Some gateways send **delta** slices (concatenate);
 * others send the **full assistant output so far** each time. Naive `buffer += chunk` duplicates
 * cumulative payloads and balloons the chat bubble.
 */
export function mergeStreamTextChunk(buffer: string, chunk: string): string {
  if (!chunk) return buffer
  if (!buffer) return chunk
  if (chunk.startsWith(buffer)) return chunk
  return buffer + chunk
}

function extractTaggedJSON(raw: string, tag: string): unknown | null {
  const plain = `json:${tag}`
  const fenced = `\`\`\`${plain}`
  let idx = raw.indexOf(plain)
  let skip = plain.length
  if (idx < 0) {
    idx = raw.indexOf(fenced)
    if (idx < 0) return null
    skip = fenced.length
  }

  let rest = raw.slice(idx + skip).trim()
  rest = rest.replace(/^[:\s]+/, '')
  rest = stripCodeFences(rest)

  // If parsing fails, try to recover from the first JSON token.
  const parsed = safeParseJSON(rest)
  if (parsed !== null) return parsed

  const first = rest.search(/[[{]/)
  if (first < 0) return null
  const lastObj = rest.lastIndexOf('}')
  const lastArr = rest.lastIndexOf(']')
  const last = Math.max(lastObj, lastArr)
  if (last <= first) return null

  const candidate = rest.slice(first, last + 1)
  return safeParseJSON(candidate)
}

/** Parse JSON after a `json:tag` or fenced block body (handles trailing fences / brace slice). */
function parseJsonSnippet(rest: string): unknown | null {
  let r = rest.trim()
  r = stripCodeFences(r)
  r = r.replace(/^[:\s]+/, '')
  const parsed = safeParseJSON(r)
  if (parsed !== null) return parsed
  const first = r.search(/[[{]/)
  if (first < 0) return null
  const lastObj = r.lastIndexOf('}')
  const lastArr = r.lastIndexOf(']')
  const last = Math.max(lastObj, lastArr)
  if (last <= first) return null
  return safeParseJSON(r.slice(first, last + 1))
}

const JSON_BLOCK_TAGS = ['topics', 'draft', 'score', 'originality', 'style_rules'] as const

function emitFromParsedJson(tag: string, raw: unknown, emit: (evt: OpenClawEvent) => void) {
  switch (tag) {
    case 'topics': {
      const topicsNorm = normalizeTrendSignals(raw)
      if (topicsNorm) {
        // eslint-disable-next-line no-console
        console.log('[openclawClient] parsed json:topics')
        emit({ type: 'topics', topics: topicsNorm })
      }
      break
    }
    case 'draft': {
      const draftNorm = normalizeDraftPayload(raw)
      if (draftNorm) {
        // eslint-disable-next-line no-console
        console.log('[openclawClient] parsed json:draft')
        emit({ type: 'draft', draft: draftNorm })
      }
      break
    }
    case 'score': {
      const scoreNorm = normalizeQualityScore(raw)
      if (scoreNorm) {
        // eslint-disable-next-line no-console
        console.log('[openclawClient] parsed json:score')
        emit({ type: 'score', score: scoreNorm })
      }
      break
    }
    case 'originality': {
      const originalityNorm = normalizeOriginalityReport(raw)
      if (originalityNorm) {
        // eslint-disable-next-line no-console
        console.log('[openclawClient] parsed json:originality')
        emit({ type: 'originality', originality: originalityNorm })
      }
      break
    }
    case 'style_rules': {
      // eslint-disable-next-line no-console
      console.log('[openclawClient] parsed json:style_rules')
      emit({ type: 'style_rules', rules: raw as StyleRule[] })
      break
    }
    default:
      break
  }
}

/**
 * Fenced ```json:topics``` / ```json:draft``` blocks (per Gateway + Skill). Primary: newline after tag; fallback: looser fence.
 */
function extractJsonBlocks(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const patterns = [/```json:(\w+)\s*\n([\s\S]*?)```/g, /```json:(\w+)\s*([\s\S]*?)```/g]
  for (const regex of patterns) {
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const tag = match[1].toLowerCase()
      if (result[tag] !== undefined) continue
      const inner = match[2].trim()
      try {
        result[tag] = JSON.parse(inner)
      } catch {
        const recovered = parseJsonSnippet(inner)
        if (recovered != null) {
          result[tag] = recovered
        } else {
          // eslint-disable-next-line no-console
          console.warn('[openclawClient] Failed to parse json:' + tag, inner.slice(0, 160))
        }
      }
    }
  }
  return result
}

function emitJsonBlocksFromBuffer(fullText: string, emit: (evt: OpenClawEvent) => void) {
  const blocks = extractJsonBlocks(fullText)
  const seen = new Set<string>()
  for (const [k, v] of Object.entries(blocks)) {
    const tag = k.toLowerCase()
    seen.add(tag)
    emitFromParsedJson(tag, v, emit)
  }
  for (const tag of JSON_BLOCK_TAGS) {
    if (seen.has(tag)) continue
    const raw = extractTaggedJSON(fullText, tag)
    if (raw == null) continue
    emitFromParsedJson(tag, raw, emit)
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

const COVER_TYPES = new Set(['photo', 'text', 'collage', 'compare', 'list'])

function rowLooksLikeIdeashuV5Topics(o: Record<string, unknown>): boolean {
  if (typeof o.materialMatch === 'boolean') return true
  const timing = o.timing
  if (typeof timing === 'string' && (timing === 'hot' || timing === 'evergreen')) return true
  if (
    typeof o.source === 'string' &&
    o.source.length > 0 &&
    typeof o.angle === 'string' &&
    typeof o.title === 'string'
  ) {
    return true
  }
  return false
}

function normalizeTrendSignals(raw: unknown): TrendSignal[] | null {
  let arr: unknown[] | null = null
  if (Array.isArray(raw)) arr = raw
  else if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).topics)) {
    arr = (raw as Record<string, unknown>).topics as unknown[]
  }
  if (!arr || arr.length === 0) return null

  return arr.map((item, i) => {
    const o = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const id =
      typeof o.id === 'string' && o.id.length > 0
        ? o.id
        : typeof o.id === 'number'
          ? String(o.id)
          : `topic_${i}`

    if (rowLooksLikeIdeashuV5Topics(o)) {
      const title = String(o.title ?? '选题')
      const source = String(o.source ?? '')
      const angle = String(o.angle ?? '')
      const hook = String(o.hook ?? '')
      const timing = String(o.timing ?? 'hot')
      const timingDetail = String(o.timingDetail ?? '')
      const materialMatch = typeof o.materialMatch === 'boolean' ? o.materialMatch : false
      const mc = o.materialCount
      const materialCount = typeof mc === 'number' ? mc : Number(mc)
      const materialCountNorm = Number.isFinite(materialCount) ? materialCount : 0

      const lifecycle: TrendSignal['lifecycle'] =
        timing === 'evergreen' ? 'peak' : timing === 'hot' ? 'hot' : 'emerging'

      const angles = [angle, hook, timingDetail].map((s) => s.trim()).filter((s) => s.length > 0)

      return {
        id,
        keyword: title,
        title,
        heatScore: materialMatch ? 88 : 58,
        lifecycle,
        sources: [{ platform: '热点来源', metrics: source || '—' }],
        suggestedAngles: angles.length > 0 ? angles : ['切入角度', '钩子'],
        topicSource: source,
        angle: angle || undefined,
        hook: hook || undefined,
        timing,
        timingDetail: timingDetail || undefined,
        materialMatch,
        materialCount: materialCountNorm,
      }
    }

    const keyword = String(o.keyword ?? o.title ?? '选题')
    const title = String(o.title ?? keyword)
    const heat = typeof o.heatScore === 'number' ? o.heatScore : Number(o.heatScore)
    const heatScore = Number.isFinite(heat) ? clamp(heat, 0, 100) : 70
    const lifecycleRaw = String(o.lifecycle ?? 'hot')
    const lifecycle: TrendSignal['lifecycle'] = ['emerging', 'hot', 'peak', 'declining'].includes(
      lifecycleRaw,
    )
      ? (lifecycleRaw as TrendSignal['lifecycle'])
      : 'hot'
    const sources: TrendSignal['sources'] = Array.isArray(o.sources)
      ? (o.sources as TrendSignal['sources'])
      : [{ platform: '小红书', metrics: '—' }]
    const angles = Array.isArray(o.suggestedAngles)
      ? (o.suggestedAngles as unknown[]).map((a) => String(a))
      : ['细节切入', '可复用步骤']
    return {
      id,
      keyword,
      title,
      heatScore,
      lifecycle,
      sources,
      suggestedAngles: angles,
    }
  })
}

function normalizeDraftPayload(raw: unknown): Draft | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  let body: unknown = o.body
  if (Array.isArray(body)) body = (body as unknown[]).map((b) => String(b)).join('\n\n')
  const bodyStr = String(body ?? '')
  const coverRaw =
    o.cover && typeof o.cover === 'object' ? (o.cover as Record<string, unknown>) : {}
  const t = String(coverRaw.type ?? 'photo')
  const coverType = COVER_TYPES.has(t) ? (t as Draft['cover']['type']) : 'photo'
  const status = o.status
  const draft: Draft = {
    title: String(o.title ?? ''),
    body: bodyStr,
    tags: Array.isArray(o.tags) ? (o.tags as unknown[]).map((x) => String(x)) : [],
    cover: {
      type: coverType,
      description: String(coverRaw.description ?? ''),
      overlayText: String(coverRaw.overlayText ?? coverRaw.overlay ?? o.title ?? ''),
      imageUrl: typeof coverRaw.imageUrl === 'string' ? coverRaw.imageUrl : undefined,
    },
  }
  if (typeof status === 'string' && status.length > 0) {
    draft.status = status
  }
  const mode = o.mode
  if (typeof mode === 'string' && mode.length > 0) {
    draft.mode = mode
  }
  const structureType = o.structureType
  if (typeof structureType === 'string' && structureType.length > 0) {
    draft.structureType = structureType
  }
  if (Array.isArray(o.materialAnchors)) {
    draft.materialAnchors = (o.materialAnchors as unknown[]).map((x) => String(x))
  }
  return draft
}

function normalizeQualityScore(raw: unknown): QualityScore | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const dimKeys = ['hook', 'authentic', 'aiSmell', 'diversity', 'cta', 'platform'] as const
  const rawDims = dimKeys
    .map((k) => {
      const v = o[k]
      const num = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(num) ? num : NaN
    })
    .filter((n) => !Number.isNaN(n))
  /** ideashu-v5 `json:score` uses 0–10 per dimension; UI expects 0–100. */
  const scaleToPct = rawDims.length > 0 && Math.max(...rawDims) <= 10 ? 10 : 1

  const n = (k: string) => {
    const v = o[k]
    const num = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(num) ? clamp(num * scaleToPct, 0, 100) : 70
  }
  const suggestions = Array.isArray(o.suggestions)
    ? (o.suggestions as unknown[]).map((s) => String(s))
    : ['继续微调即可。']
  return {
    hook: n('hook'),
    authentic: n('authentic'),
    aiSmell: n('aiSmell'),
    diversity: n('diversity'),
    cta: n('cta'),
    platform: n('platform'),
    suggestions,
  }
}

function normalizeOriginalityReport(raw: unknown): OriginalityReport | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const um = typeof o.userMaterialPct === 'number' ? o.userMaterialPct : Number(o.userMaterialPct)
  const ai = typeof o.aiAssistPct === 'number' ? o.aiAssistPct : Number(o.aiAssistPct)
  const userMaterialPct = Number.isFinite(um) ? clamp(um, 0, 100) : 60
  const aiAssistPct = Number.isFinite(ai) ? clamp(ai, 0, 100) : 40
  const cRaw = String(o.compliance ?? 'safe')
  const compliance: OriginalityReport['compliance'] =
    cRaw === 'safe' || cRaw === 'caution' || cRaw === 'risk' ? cRaw : 'safe'
  const materialSources = Array.isArray(o.materialSources)
    ? (o.materialSources as unknown[]).map((s) => String(s))
    : []
  return {
    userMaterialPct,
    aiAssistPct,
    compliance,
    materialSources,
  }
}

export function createOpenClawClient({
  url = 'ws://127.0.0.1:18789/',
  connectTimeoutMs = 1500,
}: {
  url?: string
  connectTimeoutMs?: number
} = {}): OpenClawClient {
  let ws: WebSocket | null = null
  let connected = false
  let sessionKey: string | null = null
  let operatorAuthPromise:
    | Promise<{ gatewayToken: string; deviceToken: string } | null>
    | null = null

  // pending request resolvers for gateway frames (type: "res")
  const pendingRes = new Map<
    string,
    {
      resolve: (payload: unknown) => void
      reject: (err: unknown) => void
    }
  >()

  const eventListeners = new Set<(evt: OpenClawEvent) => void>()
  const connectionListeners = new Set<(ready: boolean) => void>()

  function notifyConnectionChange(ready: boolean) {
    connectionListeners.forEach((cb) => cb(ready))
  }

  let debugEventLogged = 0
  let debugAgentExtractLogged = 0

  // #region debug_mode_logging
  // Runtime evidence logger (NDJSON via local ingest server).
  const DEBUG_INGEST_URL = 'http://127.0.0.1:7242/ingest/a1565d14-fde7-4306-890c-ac1f808cce0c'
  let debugIngestSent = 0
  const DEBUG_INGEST_LIMIT = 500
  let debugAgentChatIngestCount = 0
  let debugPayloadJsonMismatchIngestCount = 0
  let debugParsedJsonIngestCount = 0
  let debugHealthLogged = 0
  let debugChatSendLogged = 0

  function postDebugLog(params: {
    hypothesisId: string
    location: string
    message: string
    data?: Record<string, unknown>
    runId?: string
  }) {
    if (debugIngestSent >= DEBUG_INGEST_LIMIT) return
    debugIngestSent += 1

    // Avoid sending huge payloads.
    const data = params.data ?? {}
    fetch(DEBUG_INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: params.runId ?? undefined,
        hypothesisId: params.hypothesisId,
        location: params.location,
        message: params.message,
        data,
        timestamp: Date.now(),
      }),
    }).catch(() => {})
  }
  // #endregion

  function emit(evt: OpenClawEvent) {
    eventListeners.forEach((cb) => cb(evt))
  }

  /** Full assistant reply text: agent chunks append `payload.data.text`; chat + `message` flushes and parses ```json:*``` blocks. */
  let messageBuffer = ''

  /** Same assistant body sometimes gets flushed twice (e.g. duplicate `chat` events); skip second emit. */
  let lastAssistantRawFingerprint: string | null = null

  /**
   * Gateway may emit several frames with different raw payloads (e.g. refreshed ```json:draft```) but identical
   * user-visible prose after stripping machine JSON — that produced multiple identical Agent bubbles.
   */
  let lastAssistantDisplayFingerprint: string | null = null

  /** reply identity used to update the same chat bubble record instead of pushing duplicates */
  let activeAssistantReplyId: string | null = null
  let fallbackAssistantReplySeq = 0

  function resetAssistantDedupe() {
    lastAssistantRawFingerprint = null
    lastAssistantDisplayFingerprint = null
    activeAssistantReplyId = null
  }

  function deriveReplyIdFromPayload(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null
    const obj = payload as Record<string, unknown>

    // Prefer explicit runId (often stable across chunks/frames).
    const runId =
      (typeof obj.runId === 'string' ? obj.runId : null) ??
      (obj.data && typeof (obj.data as any).runId === 'string' ? String((obj.data as any).runId) : null) ??
      (obj.event && typeof (obj.event as any).runId === 'string' ? String((obj.event as any).runId) : null)
    if (typeof runId === 'string' && runId.trim().length > 0) return `run:${runId.trim()}`

    // Fallback: sessionKey + seq/sequence (if present).
    const session =
      (typeof obj.sessionKey === 'string' ? obj.sessionKey : null) ??
      (typeof (obj as any).session_key === 'string' ? String((obj as any).session_key) : null) ??
      (obj.data && typeof (obj.data as any).sessionKey === 'string' ? String((obj.data as any).sessionKey) : null)
    const seq =
      (typeof obj.seq === 'number' ? obj.seq : null) ??
      (typeof obj.sequence === 'number' ? obj.sequence : null) ??
      (typeof (obj as any).sequence === 'string' ? Number((obj as any).sequence) : null) ??
      (obj.data && typeof (obj.data as any).seq === 'number' ? (obj.data as any).seq : null) ??
      (obj.data && typeof (obj.data as any).sequence === 'number' ? (obj.data as any).sequence : null)

    if (typeof session === 'string' && typeof seq === 'number' && Number.isFinite(seq)) {
      return `sk:${session}:${seq}`
    }

    // If only sessionKey exists, use a stable per-run fallback (still better than per-frame unique ids).
    if (sessionKey && sessionKey.length > 0) return `sk:${sessionKey}:generic`

    return null
  }

  function clearMessageBuffer() {
    messageBuffer = ''
  }

  function emitAssistantParse(raw: string, replyId: string) {
    const fp = `${replyId}::${raw.trim()}`
    if (!fp) return
    if (lastAssistantRawFingerprint === fp) {
      // eslint-disable-next-line no-console
      console.warn('[openclawClient] skip duplicate assistant parse (identical raw text)')
      return
    }
    lastAssistantRawFingerprint = fp

    const displayText = stripMachineJsonFromChatDisplay(raw)
    const displayNorm = displayText.replace(/\s+/g, ' ').trim()
    if (displayNorm.length > 0) {
      const displayKey = `${replyId}::${displayNorm}`
      if (displayKey === lastAssistantDisplayFingerprint) {
        // eslint-disable-next-line no-console
        console.warn('[openclawClient] skip duplicate assistant_reply (same visible text after strip, different raw)')
      } else {
        lastAssistantDisplayFingerprint = displayKey
        emit({ type: 'assistant_reply', replyId, text: displayText })
      }
    }

    emitJsonBlocksFromBuffer(raw, emit)
  }

  function parseCompleteAssistantTextFromPayload(
    text: string,
    options?: { debugJsonPreview?: boolean },
    replyId?: string | null,
  ) {
    if (options?.debugJsonPreview && text.includes('json:')) {
      // eslint-disable-next-line no-console
      console.log('[openclawClient] json text preview:', text.slice(0, 240))
    }
    const rid = replyId ?? activeAssistantReplyId ?? `${sessionKey ?? 'nosession'}::fb_${fallbackAssistantReplySeq++}`
    emitAssistantParse(text, rid)
  }

  function parseAndEmitMessageBuffer(reason: string, replyId: string | null) {
    const text = messageBuffer
    messageBuffer = ''
    if (!text.trim()) return
    // eslint-disable-next-line no-console
    console.log('[openclawClient] buffer tail (last 500 chars):', text.slice(-500))
    // eslint-disable-next-line no-console
    console.log('[openclawClient] extractJsonBlocks result:', JSON.stringify(extractJsonBlocks(text)))
    // eslint-disable-next-line no-console
    console.log('[openclawClient] message complete, parse', reason, 'len=', text.length)
    try {
      if (debugParsedJsonIngestCount < 10) {
        debugParsedJsonIngestCount += 1
        postDebugLog({
          hypothesisId: 'H2_json_present_and_parsed',
          location: 'openclawClient.ts:parseAndEmitMessageBuffer',
          message: 'parsedMessageBuffer',
          data: {
            reason,
            textLen: text.length,
            textPreview: text.slice(0, 120).replace(/\s+/g, ' '),
          },
        })
      }
    } catch {}
    const rid = replyId ?? activeAssistantReplyId ?? `${sessionKey ?? 'nosession'}::fb_${fallbackAssistantReplySeq++}`
    emitAssistantParse(text, rid)
  }

  function randomId(prefix = 'id') {
    const cryptoObj = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto
    if (cryptoObj?.randomUUID) return `${prefix}_${cryptoObj.randomUUID()}`
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`
  }

  function sendFrame(frame: unknown) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(frame))
  }

  function extractTextFromPayload(payload: unknown): string | null {
    if (payload == null) return null
    if (typeof payload === 'string') return payload
    if (typeof payload !== 'object') return null

    const obj = payload as Record<string, unknown>
    if (typeof obj.content === 'string') return obj.content
    if (typeof obj.text === 'string') return obj.text
    if (typeof obj.message === 'string') return obj.message

    const msg = obj.message as unknown
    if (typeof msg === 'string') return msg
    if (typeof msg === 'object' && msg) {
      const msgObj = msg as Record<string, unknown>
      if (typeof msgObj.content === 'string') return msgObj.content
      if (typeof msgObj.text === 'string') return msgObj.text
    }

    // Prefer the first string containing `json:` tags; otherwise only accept
    // a string that "looks like" assistant text (avoid runId/sessionKey/id).
    let foundJson: string | null = null
    let bestText: string | null = null
    let bestLen = 0
    const looksLikeAssistantText = (s: string) => {
      if (s.includes('json:')) return true
      // Most skill outputs are Chinese and/or contain formatting separators.
      if (/[\u4e00-\u9fff]/.test(s)) return true
      if (s.includes('━━━━━━━━')) return true
      if (s.includes('选题') || s.includes('草稿') || s.includes('评分') || s.includes('原创度')) return true
      if (s.includes('\n')) return true
      // Long messages are very likely real assistant text.
      if (s.length >= 80) return true
      return false
    }

    const walk = (v: unknown) => {
      if (foundJson && bestText) return
      if (typeof v === 'string') {
        if (!foundJson && v.includes('json:')) {
          foundJson = v
          return
        }
        if (looksLikeAssistantText(v)) {
          if (v.length > bestLen) {
            bestLen = v.length
            bestText = v
          }
        }
        return
      }
      if (Array.isArray(v)) {
        for (const it of v) walk(it)
        return
      }
      if (typeof v === 'object' && v) {
        for (const it of Object.values(v)) walk(it)
      }
    }

    walk(payload)
    if (foundJson) return foundJson
    // #region debug_mode_payload_json_mismatch
    try {
      const candidate = bestText as unknown
      if (
        debugPayloadJsonMismatchIngestCount < 10 &&
        typeof candidate === 'string' &&
        candidate.length > 0 &&
        !candidate.includes('json:')
      ) {
        let rawHasJsonColon = false
        try {
          rawHasJsonColon = JSON.stringify(payload).includes('json:')
        } catch {}
        if (rawHasJsonColon) {
          debugPayloadJsonMismatchIngestCount += 1
          postDebugLog({
            hypothesisId: 'H2_payload_has_json_but_extraction_missed',
            location: 'openclawClient.ts:extractTextFromPayload',
            message: 'payloadContainsJsonButExtractorReturnedNoJson',
            data: {
              bestTextLen: candidate.length,
              bestTextPreview: candidate.slice(0, 120).replace(/\s+/g, ' '),
            },
          })
        }
      }
    } catch {}
    // #endregion
    return bestText
  }

  async function loadOperatorToken(): Promise<{ gatewayToken: string; deviceToken: string } | null> {
    if (operatorAuthPromise) return operatorAuthPromise

    operatorAuthPromise = (async () => {
      try {
        const resp = await fetch('/__openclaw_device_auth', { method: 'GET' })
        if (!resp.ok) return null
        const data = (await resp.json()) as any
        if (typeof data?.gatewayToken !== 'string') return null
        if (typeof data?.deviceToken !== 'string') return null
        return { gatewayToken: data.gatewayToken, deviceToken: data.deviceToken }
      } catch {
        return null
      }
    })()

    return operatorAuthPromise
  }

  async function loadDeviceIdentityForConnect(params: {
    nonce: string
    signedAtMs: number
    token: string
    clientId: string
    clientMode: string
    role: string
    scopes: string[]
    platform: string
    deviceFamily?: string
  }): Promise<
    | null
    | {
        id: string
        publicKey: string
        signature: string
        signedAt: number
        nonce: string
      }
  > {
    try {
      const qs = new URLSearchParams({
        nonce: params.nonce,
        signedAtMs: String(params.signedAtMs),
        token: params.token,
        clientId: params.clientId,
        clientMode: params.clientMode,
        role: params.role,
        scopes: params.scopes.join(','),
        platform: params.platform,
        deviceFamily: params.deviceFamily ?? '',
      })

      const resp = await fetch(`/__openclaw_device_identity?${qs.toString()}`, { method: 'GET' })
      if (!resp.ok) return null
      const data = (await resp.json()) as any
      const device = data?.device
      if (
        typeof device?.id === 'string' &&
        typeof device?.publicKey === 'string' &&
        typeof device?.signature === 'string' &&
        typeof device?.signedAt === 'number' &&
        typeof device?.nonce === 'string'
      ) {
        return {
          id: device.id,
          publicKey: device.publicKey,
          signature: device.signature,
          signedAt: device.signedAt,
          nonce: device.nonce,
        }
      }
      return null
    } catch {
      return null
    }
  }

  async function connect() {
    if (connected) return

    connected = false
    sessionKey = null
    pendingRes.clear()
    clearMessageBuffer()

    ws = new WebSocket(url)
    const socket = ws

    const ready = new Promise<void>((resolve) => {
      let settled = false
      const settle = (ok: boolean) => {
        if (settled) return
        settled = true
        if (!ok) {
          connected = false
          try {
            ws?.close()
          } catch {}
          ws = null
          notifyConnectionChange(false)
        }
        resolve()
      }

      const timer = window.setTimeout(() => {
        settle(false)
      }, connectTimeoutMs)

      const finishOk = () => {
        window.clearTimeout(timer)
        settle(true)
      }

      socket.onopen = () => {
        // wait for connect.challenge
        // eslint-disable-next-line no-console
        console.log('[openclawClient] ws open, waiting connect.challenge...')
      }

      socket.onerror = () => {
        window.clearTimeout(timer)
        settle(false)
        // eslint-disable-next-line no-console
        console.log('[openclawClient] ws error (gateway unavailable)')
      }

      socket.onclose = (ev) => {
        if (connected) {
          connected = false
          sessionKey = null
          notifyConnectionChange(false)
        }
        // eslint-disable-next-line no-console
        console.log('[openclawClient] ws close', { code: ev.code, reason: ev.reason })
      }

      socket.onmessage = async (event) => {
        const raw = typeof event.data === 'string' ? event.data : null
        if (!raw) return

        const parsed = safeParseJSON(raw)
        if (!parsed || typeof parsed !== 'object') return

        const frame = parsed as Record<string, unknown>
        const type = frame.type

        if (type === 'event') {
          const evtName = frame.event
          if (debugEventLogged < 10) {
            debugEventLogged += 1
            const payload = frame.payload as any
            const keys = payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 8) : []
            // eslint-disable-next-line no-console
            console.log('[openclawClient] event=', evtName, 'payloadKeys=', keys)
          }
          // #region debug_mode_health_event
          if (evtName === 'health' && debugHealthLogged < 3) {
            debugHealthLogged += 1
            const hp = frame.payload as any
            postDebugLog({
              hypothesisId: 'H9_gateway_default_agent',
              location: 'openclawClient.ts:health_event',
              message: 'gatewayHealthSnapshot',
              data: {
                defaultAgentId: typeof hp?.defaultAgentId === 'string' ? hp.defaultAgentId : null,
                channelOrder: Array.isArray(hp?.channelOrder) ? hp.channelOrder.slice(0, 6) : null,
                channelLabelsLen: hp?.channelLabels && typeof hp.channelLabels === 'object' ? Object.keys(hp.channelLabels).length : null,
              },
            })
          }
          // #endregion
          if (evtName === 'connect.challenge') {
            const nonce = (frame.payload as any)?.nonce
            if (typeof nonce !== 'string' || nonce.trim().length === 0) {
              window.clearTimeout(timer)
              settle(false)
              return
            }

            // send gateway connect request
            const reqId = randomId('conn')
            pendingRes.set(reqId, {
              resolve: (payload) => {
                const sd = (payload as any)?.snapshot?.sessionDefaults
                sessionKey =
                  typeof sd?.mainSessionKey === 'string'
                    ? sd.mainSessionKey
                    : typeof sd?.mainKey === 'string'
                      ? sd.mainKey
                      : null

                if (sessionKey) {
                  connected = true
                  notifyConnectionChange(true)
                  finishOk()
                } else {
                  window.clearTimeout(timer)
                  settle(false)
                }
              },
              reject: () => {
                window.clearTimeout(timer)
                settle(false)
              },
            })

            const auth = await loadOperatorToken()

            if (!auth) {
              window.clearTimeout(timer)
              settle(false)
              return
            }

            const connectScopes = ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing']
            const signedAtMs = Date.now()
            const deviceIdentity = await loadDeviceIdentityForConnect({
              nonce,
              signedAtMs,
              token: auth.gatewayToken,
              clientId: 'gateway-client',
              clientMode: 'backend',
              role: 'operator',
              scopes: connectScopes,
              platform: 'win32',
              deviceFamily: undefined,
            })

            if (!deviceIdentity) {
              window.clearTimeout(timer)
              settle(false)
              return
            }

            // eslint-disable-next-line no-console
            console.log('[openclawClient] connect.req', {
              platform: 'win32',
              scopes: connectScopes.join(','),
              nonce,
            })

            sendFrame({
              type: 'req',
              id: reqId,
              method: 'connect',
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: 'gateway-client',
                  displayName: 'ideashu-web',
                  version: 'ideashu-web',
                  // Must match the paired device platform (pinnedPlatform) to avoid metadata-upgrade -> pairing-required.
                  platform: 'win32',
                  mode: 'backend',
                },
                caps: [],
                role: 'operator',
                // chat.send 需要 operator.write；仅依赖 operator.admin 可能无法满足网关 scope 校验。
                scopes: connectScopes,
                device: deviceIdentity,
                auth: { token: auth.gatewayToken, deviceToken: auth.deviceToken },
              },
            })
            return
          }

          const payload = frame.payload

          if (evtName === 'agent') {
            const p = payload as Record<string, unknown> | null | undefined
            const data = p?.data
            const chunk =
              data != null && typeof data === 'object' && !Array.isArray(data)
                ? String((data as Record<string, unknown>).text ?? '')
                : ''
            const wasEmpty = messageBuffer.length === 0
            messageBuffer = mergeStreamTextChunk(messageBuffer, chunk)
            if (wasEmpty) {
              const derived = deriveReplyIdFromPayload(payload)
              activeAssistantReplyId =
                derived ??
                `${sessionKey ?? 'nosession'}::fb_${fallbackAssistantReplySeq++}`
            }
            if (debugAgentExtractLogged < 20) {
              debugAgentExtractLogged += 1
              // eslint-disable-next-line no-console
              console.log('[openclawClient] agent chunk', {
                chunkLen: chunk.length,
                bufferLen: messageBuffer.length,
              })
            }
            try {
              if (debugAgentChatIngestCount < 250) {
                debugAgentChatIngestCount += 1
                postDebugLog({
                  hypothesisId: 'H1_or_H3_skill_text_missing_json',
                  location: 'openclawClient.ts:agent_stream_chunk',
                  message: 'agent stream chunk',
                  data: {
                    evtName,
                    chunkLen: chunk.length,
                    bufferLen: messageBuffer.length,
                    framePayloadKeys:
                      payload && typeof payload === 'object' ? Object.keys(payload as Record<string, unknown>).slice(0, 8) : [],
                  },
                  runId:
                    payload && typeof payload === 'object' && typeof (payload as any).runId === 'string'
                      ? String((payload as any).runId)
                      : undefined,
                })
              }
            } catch {}
            return
          }

          if (evtName === 'chat') {
            const p = payload as Record<string, unknown> | null | undefined
            const hasMessage = p != null && typeof p === 'object' && 'message' in p && p.message != null
            if (hasMessage) {
              parseAndEmitMessageBuffer('chat+message', activeAssistantReplyId)
            }
            if (debugAgentExtractLogged < 40) {
              debugAgentExtractLogged += 1
              // eslint-disable-next-line no-console
              console.log('[openclawClient] chat event', {
                hasMessage,
                bufferLen: messageBuffer.length,
              })
            }
            try {
              if (debugAgentChatIngestCount < 250) {
                debugAgentChatIngestCount += 1
                postDebugLog({
                  hypothesisId: 'H1_or_H3_skill_text_missing_json',
                  location: 'openclawClient.ts:chat_event',
                  message: 'chat event',
                  data: {
                    evtName,
                    hasMessage,
                    bufferLen: messageBuffer.length,
                    framePayloadKeys:
                      payload && typeof payload === 'object' ? Object.keys(payload as Record<string, unknown>).slice(0, 8) : [],
                  },
                })
              }
            } catch {}
            return
          }

          const text = extractTextFromPayload(payload)
          if (text && text.includes('json:')) {
            const replyId = deriveReplyIdFromPayload(payload) ?? activeAssistantReplyId
            parseCompleteAssistantTextFromPayload(text, { debugJsonPreview: true }, replyId)
          }
          return
        }

        if (type === 'res') {
          const id = frame.id
          if (typeof id !== 'string') return
          const pending = pendingRes.get(id)
          if (!pending) return

          pendingRes.delete(id)
          const ok = frame.ok === true
          if (!ok) pending.reject((frame as any).error ?? new Error('gateway error'))
          else pending.resolve((frame as any).payload)
          return
        }
      }
    })

    await ready
  }

  function disconnect() {
    connected = false
    sessionKey = null
    pendingRes.clear()
    clearMessageBuffer()
    resetAssistantDedupe()
    try {
      ws?.close()
    } catch {}
    ws = null
    notifyConnectionChange(false)
  }

  function isReady() {
    return (
      ws !== null &&
      ws.readyState === WebSocket.OPEN &&
      connected &&
      sessionKey !== null &&
      sessionKey.length > 0
    )
  }

  function send(content: string) {
    if (!isReady()) {
      // eslint-disable-next-line no-console
      console.warn('[openclawClient] send skipped: gateway not ready (no mock fallback)')
      return
    }

    clearMessageBuffer()
    resetAssistantDedupe()

    // We use chat.send because it creates/uses the default gateway session.
    // Skill output is expected to appear in subsequent event frames as assistant text containing `json:*` blocks.
    const reqId = randomId('chat')
    const message = content

    // #region debug_mode_chat_send
    if (debugChatSendLogged < 8) {
      debugChatSendLogged += 1
      postDebugLog({
        hypothesisId: 'H8_outbound_chat_send',
        location: 'openclawClient.ts:send',
        message: 'chat.send outbound message preview',
        data: {
          messageLen: message.length,
          messagePreview: message.slice(0, 200).replace(/\s+/g, ' '),
          sessionKeySuffix: sessionKey ? sessionKey.slice(-8) : null,
        },
      })
    }
    // #endregion

    sendFrame({
      type: 'req',
      id: reqId,
      method: 'chat.send',
      params: {
        sessionKey,
        message,
        idempotencyKey: randomId('idem'),
      },
    })
  }

  return {
    connect,
    disconnect,
    send,
    isReady,
    onConnectionChange: (cb) => {
      connectionListeners.add(cb)
      cb(isReady())
      return () => {
        connectionListeners.delete(cb)
      }
    },
    onEvent: (cb) => {
      eventListeners.add(cb)
      return () => {
        eventListeners.delete(cb)
      }
    },
  }
}

