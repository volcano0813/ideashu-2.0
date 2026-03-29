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
  /** ideashu-v5 optional trace URL (normalized in `sources[].url` when valid) */
  sourceUrl?: string
  /** ISO date when the linked article was published (if provided by API) */
  publishedAt?: string
}

function isHttpOrHttpsUrlString(s: string): boolean {
  try {
    const u = new URL(s.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** True if the signal has a verifiable http(s) link on `sourceUrl` or any `sources[].url`. */
export function hasTraceableHttpsUrl(sig: TrendSignal): boolean {
  const top = typeof sig.sourceUrl === 'string' ? sig.sourceUrl.trim() : ''
  if (top && isHttpOrHttpsUrlString(top)) return true
  for (const s of sig.sources ?? []) {
    const u = typeof s?.url === 'string' ? s.url.trim() : ''
    if (u && isHttpOrHttpsUrlString(u)) return true
  }
  return false
}

/** Hotspot pipeline: drop topics without a traceable URL (avoids loose/table fake cards). */
export function filterTrendSignalsWithTraceableUrl(signals: TrendSignal[]): TrendSignal[] {
  return signals.filter(hasTraceableHttpsUrl)
}

/** Hostnames that indicate docs/help fallbacks, not verifiable news/event sources. */
const HOTSPOT_META_DOC_HOSTS = new Set(['docs.openclaw.ai'])

function collectTraceableHttpsUrls(sig: TrendSignal): string[] {
  const out: string[] = []
  const top = typeof sig.sourceUrl === 'string' ? sig.sourceUrl.trim() : ''
  if (top && isHttpOrHttpsUrlString(top)) out.push(top)
  for (const s of sig.sources ?? []) {
    const u = typeof s?.url === 'string' ? s.url.trim() : ''
    if (u && isHttpOrHttpsUrlString(u)) out.push(u)
  }
  return out
}

/**
 * True when the signal is a Skill/gateway "cannot search" row that still satisfies https traceability
 * (e.g. only links to docs.openclaw.ai), or matches limitation copy + doc link.
 */
export function isHotspotMetaLimitationSignal(sig: TrendSignal): boolean {
  const urls = collectTraceableHttpsUrls(sig)
  const textBlob = [sig.title, sig.topicSource, sig.hook, sig.angle].filter(Boolean).join('\n')
  if (urls.length === 0) {
    // 无链接时仍可能是「缺 BRAVE / 请粘贴链接」整段说明被误解析成一条选题
    return (
      /BRAVE_API_KEY|Brave\s*API|无法调用实时搜索工具|缺少\s*BRAVE|系统限制说明|来源[：:]\s*系统限制|无法提供实时|需要搜索权限|搜索权限或手动|请粘贴您|粘贴您.*链接/i.test(
        textBlob,
      ) || /系统限制说明|来源[：:]\s*系统限制/.test(String(sig.topicSource ?? '').trim())
    )
  }

  const hosts = urls.map((u) => {
    try {
      return new URL(u).hostname.toLowerCase()
    } catch {
      return ''
    }
  }).filter(Boolean)

  const onlyMetaDocHosts =
    hosts.length > 0 && hosts.every((h) => HOTSPOT_META_DOC_HOSTS.has(h))

  const limitationWording =
    /无法提供实时|需要搜索权限|搜索权限或手动|手动提供信源/.test(textBlob) ||
    /系统限制说明|来源[：:]\s*系统限制/.test(textBlob) ||
    /BRAVE_API_KEY|Brave\s*API|无法调用实时搜索工具|缺少\s*BRAVE/i.test(textBlob)
  const limitationSourceField = /系统限制说明|^系统限制$/.test(String(sig.topicSource ?? '').trim())

  if (onlyMetaDocHosts) return true
  if (limitationWording && limitationSourceField) return true
  if (limitationWording && hosts.some((h) => HOTSPOT_META_DOC_HOSTS.has(h))) return true

  return false
}

/** Traceable https only, then drop meta/limitation rows (docs-only or explicit failure copy). */
export function filterTrendSignalsForHotspotUi(signals: TrendSignal[]): TrendSignal[] {
  return filterTrendSignalsWithTraceableUrl(signals).filter((s) => !isHotspotMetaLimitationSignal(s))
}

function finishTopicsWithTraceableFilter(norm: TrendSignal[] | null): TrendSignal[] | null {
  if (!norm || norm.length === 0) return null
  const strict = filterTrendSignalsForHotspotUi(norm)
  if (strict.length > 0) return strict
  // 助手常漏填 sourceUrl：宁可展示无链接卡片（HotCard 内提示补链），也不要整页失败
  const relaxed = norm.filter((s) => !isHotspotMetaLimitationSignal(s))
  if (relaxed.length > 0) return relaxed
  // 若每条都被判为「限制说明」等（正则误判常见），仍返回原始列表，避免控制台已解析出 topics 但 UI 整页失败
  return norm
}

export type StyleRule = {
  id: string
  category: 'word' | 'structure' | 'detail' | 'tone'
  description: string
  sourceEditIds: string[]
  enabled: boolean
  createdAt: string
}

/**
 * ideashu-v5 `json:cover` after Kolors (SiliconFlow) image generation.
 * Skill 应输出：` ```json:cover\n{ "mode":"text2img"|"img2img", "imageUrl":"<https URL 或 data:image/...>", "overlayText":"..." }\n``` `
 */
export type CoverPayload = {
  mode: 'text2img' | 'img2img'
  imageUrl: string
  overlayText?: string
  prompt?: string
  strength?: number
  iteration?: number
}

export type OpenClawEvent =
  | { type: 'topics'; topics: TrendSignal[] }
  | { type: 'draft'; draft: Draft }
  | { type: 'cover'; cover: CoverPayload }
  | { type: 'score'; score: QualityScore }
  | { type: 'originality'; originality: OriginalityReport }
  | { type: 'style_rules'; rules: StyleRule[] }
  /** Natural-language part of assistant reply (```json:*``` fences removed) for chat UI. `rawFull` is the unmodified assistant body for parsers (e.g. Hotspot). */
  | { type: 'assistant_reply'; replyId: string; text: string; rawFull?: string }

export type OpenClawClient = {
  connect: () => Promise<void>
  disconnect: () => void
  /** Plain user text to Gateway (same as Feishu client). Returns false if gateway not ready (message not sent). */
  send: (content: string) => boolean
  /** Clear stream buffer + assistant dedupe (e.g. after switching account) without dropping the WebSocket. */
  resetAssistantStreamState: () => void
  onEvent: (cb: (evt: OpenClawEvent) => void) => () => void
  /** Latest assistant prose (for StrictMode remount / missed React state sync). Cleared on send/connect/disconnect. */
  getLastAssistantReply: () => Extract<OpenClawEvent, { type: 'assistant_reply' }> | null
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
  if (buffer.startsWith(chunk)) return buffer
  if (buffer.endsWith(chunk)) return buffer
  if (chunk.endsWith(buffer)) return chunk

  const max = Math.min(buffer.length, chunk.length)
  for (let len = max; len >= 1; len--) {
    if (chunk.startsWith(buffer.slice(buffer.length - len))) {
      return buffer + chunk.slice(len)
    }
  }
  return buffer + chunk
}

/** When the merged buffer is literally two identical halves (bad concat / duplicate frame), keep one. */
function collapseDoubledAssistantProse(s: string): string {
  let t = s.trim()
  for (let i = 0; i < 6; i++) {
    if (t.length < 120) break
    const half = Math.floor(t.length / 2)
    const a = t.slice(0, half)
    const b = t.slice(half)
    const na = a.replace(/\s+/g, ' ').trim()
    const nb = b.replace(/\s+/g, ' ').trim()
    if (na.length >= 60 && na === nb) {
      t = a.trimEnd()
      continue
    }
    break
  }
  return t
}

/** Drop consecutive duplicate blocks (streaming/gateway may replay the same section). Long blocks only. */
function collapseConsecutiveDuplicateParagraphs(s: string, minBlockChars = 45): string {
  const blocks = s.split(/\n{2,}/)
  const out: string[] = []
  const norm = (x: string) => x.replace(/\s+/g, ' ').trim()
  for (const b of blocks) {
    const t = b.trim()
    if (!t) continue
    if (t.length < minBlockChars) {
      out.push(t)
      continue
    }
    if (out.length > 0 && norm(out[out.length - 1]!) === norm(t)) continue
    out.push(t)
  }
  return out.join('\n\n')
}

function extractTaggedJSON(raw: string, tag: string): unknown | null {
  const plain = `json:${tag}`
  const plainFullwidth = `json：${tag}`
  const fenced = `\`\`\`${plain}`
  let idx = raw.indexOf(plain)
  let skip = plain.length
  if (idx < 0) {
    idx = raw.indexOf(plainFullwidth)
    if (idx >= 0) skip = plainFullwidth.length
  }
  if (idx < 0) {
    idx = raw.indexOf(fenced)
    if (idx < 0) {
      const flex = new RegExp(`json\\s*[：:]\\s*${escapeRegExp(tag)}`, 'i')
      const m = flex.exec(raw)
      if (m) {
        idx = m.index
        skip = m[0].length
      }
    } else {
      skip = fenced.length
    }
  }

  if (idx < 0) return null

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

const JSON_BLOCK_TAGS = ['topics', 'draft', 'cover', 'score', 'originality', 'style_rules'] as const

function emitFromParsedJson(tag: string, raw: unknown, emit: (evt: OpenClawEvent) => void) {
  switch (tag) {
    case 'topics': {
      const topicsNorm = normalizeTrendSignals(raw)
      if (topicsNorm) {
        const forUi = finishTopicsWithTraceableFilter(topicsNorm)
        if (!forUi || forUi.length === 0) break
        // eslint-disable-next-line no-console
        console.log('[openclawClient] parsed json:topics')
        emit({ type: 'topics', topics: forUi })
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
    case 'cover': {
      const coverNorm = normalizeCoverPayload(raw)
      if (coverNorm) {
        // eslint-disable-next-line no-console
        console.log('[openclawClient] parsed json:cover')
        emit({ type: 'cover', cover: coverNorm })
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
  const patterns = [
    /```json:(\w+)\s*\n([\s\S]*?)```/g,
    /```json:(\w+)\s*([\s\S]*?)```/g,
    /```\s*json\s*:\s*(\w+)\s*\n([\s\S]*?)```/gi,
    /```\s*json\s*:\s*(\w+)\s*([\s\S]*?)```/gi,
    // 全角冒号、或标签与换行之间仅有空白
    /```\s*json\s*[：:]\s*(\w+)\s*\r?\n([\s\S]*?)```/gi,
    /```\s*json\s*[：:]\s*(\w+)\s+([\s\S]*?)```/gi,
  ]
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

/**
 * Some models emit a bare ```json ... ``` array (no :topics tag) for topic lists.
 */
function topicsArrayFromParsedBareJson(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed) && parsed.length > 0) {
    const first = parsed[0]
    if (!first || typeof first !== 'object') return null
    const o = first as Record<string, unknown>
    if (typeof o.title !== 'string') return null
    return parsed
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const topics = (parsed as Record<string, unknown>).topics
    if (Array.isArray(topics) && topics.length > 0) {
      const first = topics[0]
      if (first && typeof first === 'object' && typeof (first as Record<string, unknown>).title === 'string') {
        return topics
      }
    }
  }
  return null
}

function extractBareJsonTopicsArray(text: string): unknown[] | null {
  const patterns = [/```json\s*\n([\s\S]*?)```/gi, /```json\s+([\s\S]*?)```/gi]
  for (const regex of patterns) {
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const inner = match[1].trim()
      if (!inner) continue
      try {
        const parsed = JSON.parse(inner)
        const arr = topicsArrayFromParsedBareJson(parsed)
        if (arr) return arr
      } catch {
        const recovered = parseJsonSnippet(inner)
        if (recovered != null) {
          const arr = topicsArrayFromParsedBareJson(recovered)
          if (arr) return arr
        }
      }
    }
  }
  return null
}

/**
 * Last-resort: find a JSON array in prose (e.g. model pasted array without fences) where objects have `title`.
 */
function tryExtractJsonArrayFromText(text: string): unknown[] | null {
  if (text.length > 120000) return null
  if (!/"title"\s*:/.test(text)) return null
  for (let end = text.length - 1; end >= 0; end--) {
    if (text[end] !== ']') continue
    let depth = 0
    let start = -1
    for (let j = end; j >= 0; j--) {
      const c = text[j]
      if (c === ']') depth++
      else if (c === '[') {
        depth--
        if (depth === 0) {
          start = j
          break
        }
      }
    }
    if (start < 0) continue
    const slice = text.slice(start, end + 1)
    try {
      const parsed = JSON.parse(slice)
      const arr = topicsArrayFromParsedBareJson(parsed)
      if (arr) return arr
    } catch {
      continue
    }
  }
  return null
}

/**
 * When the model returns a GFM table (e.g. 热点 / 钩子 / 为什么火) instead of ```json:topics```,
 * map rows into TrendSignal-shaped objects for normalizeTrendSignals.
 */
function parseMarkdownHotspotTable(text: string): unknown[] | null {
  const lines = text.split(/\r?\n/)
  const tableRows: string[][] = []
  let collecting = false
  for (const line of lines) {
    const t = line.trim()
    const isRow = t.startsWith('|') && t.endsWith('|')
    if (!isRow) {
      if (collecting && tableRows.length >= 2) break
      continue
    }
    collecting = true
    const inner = t.slice(1, -1)
    const cells = inner.split('|').map((c) => c.trim())
    if (cells.length === 0) continue
    if (cells.every((c) => /^[\s\-:|｜]+$/.test(c) || /^:?[\s\-:]+:?$/.test(c.trim()))) continue
    tableRows.push(cells)
  }
  if (tableRows.length < 2) return null

  const isSeparatorRow = (cells: string[]) =>
    cells.every((c) => /^:?[\s\-:]+:?$/.test(c.trim()) || /^[\s\-:|]+$/.test(c))
  const filtered = tableRows.filter((row) => !isSeparatorRow(row))
  if (filtered.length < 2) return null

  const header = filtered[0]!
  const headerNorm = header.map((h) => h.replace(/\s+/g, ''))
  const findIdx = (re: RegExp) => headerNorm.findIndex((h) => re.test(h))
  let titleIdx = findIdx(/热点|选题|标题|话题|方向|主题/)
  if (titleIdx < 0) titleIdx = 0
  const hookIdx = findIdx(/钩子|hook|文案|切入/)
  const whyIdx = findIdx(/火|原因|为什么|说明|价值|爆/)

  const out: unknown[] = []
  for (let r = 1; r < filtered.length; r++) {
    const cells = filtered[r]!
    const title = (cells[titleIdx] ?? cells[0] ?? '').trim()
    if (!title || /^[:：\-—|｜\s]+$/.test(title)) continue
    const hook = hookIdx >= 0 ? (cells[hookIdx] ?? '').trim() : ''
    const why = whyIdx >= 0 ? (cells[whyIdx] ?? '').trim() : ''
    const angles = [hook, why].filter((s) => s.length > 0)
    const metrics = angles.length > 0 ? angles.join(' · ') : '—'
    out.push({
      id: `topic_${out.length}`,
      title,
      keyword: title,
      heatScore: 72,
      lifecycle: 'hot',
      sources: [{ platform: '助手热点表', metrics }],
      suggestedAngles: angles.length > 0 ? angles : ['切入', '展开'],
    })
  }
  return out.length > 0 ? out : null
}

function isNoiseHotspotTitle(t: string): boolean {
  const s = t.replace(/\*\*/g, '').trim()
  if (s.length < 2 || s.length > 100) return true
  if (/请告诉我|请直接|我不再回复|继续重复同样|^\d+\s*[.)）]\s*请/.test(s)) return true
  if (/你不需要更多|不需要更多[「"]找热点/.test(s)) return true
  if (/^请选|^点选|^下一步|^告诉我\s*(现在)?$/.test(s)) return true
  if (/^关于\s*[「"']?/.test(s) || /：\s*$/.test(s)) return true
  if (/我已多次|收到你的消息|完整\s*完整/.test(s)) return true
  if (/专属选题方案|选题方案$/.test(s)) return true
  if (/\d+\s*个\s*(热点|选题)/.test(s) || /个热点角度\s*$/.test(s)) return true
  return false
}

/**
 * Assistant sometimes returns prose + bullet/checkmark lists (no JSON, no pipe table).
 * Extract list lines as weak TrendSignals so Hotspot can render cards.
 */
function parseLooseHotspotList(text: string): unknown[] | null {
  const lines = text.split(/\r?\n/)
  const seen = new Set<string>()
  const out: unknown[] = []

  const pushTitle = (raw: string) => {
    let t = raw.replace(/\*\*/g, '').replace(/^[「"'`]+/, '').replace(/[」"'`]+$/, '').trim()
    t = t.replace(/^[\s\-–—·]+/, '').trim()
    if (!t || isNoiseHotspotTitle(t)) return
    const key = t.replace(/\s+/g, ' ')
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      id: `topic_${out.length}`,
      title: t,
      keyword: t,
      heatScore: 62,
      lifecycle: 'hot' as const,
      sources: [{ platform: '助手摘要', metrics: '文本抽取' }],
      suggestedAngles: ['结合账号定位展开', '补一条真实体验'],
    })
  }

  const listItemRe =
    /^\s*(?:[-*•]+|\d+[.、．)）]\s*|✅+\s*|☑\s*)(?:\[[ xX✓]\]\s*)?(.+)$/

  for (const line of lines) {
    const trimmed = line.trim()
    const m = trimmed.match(listItemRe)
    if (m?.[1]) {
      pushTitle(m[1])
      if (out.length >= 16) break
    }
  }

  if (out.length === 0) {
    let inSection = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (/^#{1,3}\s+/.test(trimmed)) {
        inSection =
          /热点|选题|清单|角度|方向|榜单|排行|日咖|版本/.test(trimmed) && !/请告诉我|不需要/.test(trimmed)
        continue
      }
      if (trimmed.length < 60 && /\*\*[^*]+\*\*/.test(trimmed)) {
        if (/热点|选题|清单|角度|方向|版本/.test(trimmed)) {
          inSection = true
          continue
        }
      }
      if (/最简\d*热点|热点清单|\d+\s*个(选题|热点|版本)|选题角度|具体选题/.test(trimmed)) {
        inSection = true
        continue
      }
      if (inSection) {
        const m = trimmed.match(listItemRe)
        if (m?.[1]) {
          pushTitle(m[1])
          if (out.length >= 16) break
        }
      }
    }
  }

  return out.length > 0 ? out : null
}

/**
 * Stream 中已出现 ```json:topics 或未闭合的 ``` 时，说明 JSON 可能仍在生成（例如联网检索间隔数秒）。
 * 此时不应因短空闲就 flush 并清空 buffer，否则后续 chunk 会进新 buffer，热点页也会提前判失败。
 */
function bufferLooksLikeIncompleteJsonTopicsFence(raw: string): boolean {
  if (!/json:topics/i.test(raw)) return false
  const fences = raw.match(/```/g)
  return !fences || fences.length % 2 !== 0
}

/** 网关常对同一条助手回复连发多次 `chat+message`，仅空白略有差异；用于去重避免重复 topics / 刷屏 */
function normalizeAssistantRawForFingerprint(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
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
    seen.add(tag)
  }
  if (!seen.has('topics')) {
    const bare = extractBareJsonTopicsArray(fullText)
    if (bare != null) {
      emitFromParsedJson('topics', bare, emit)
    } else {
      const fromText = tryExtractJsonArrayFromText(fullText)
      if (fromText != null) {
        emitFromParsedJson('topics', fromText, emit)
      } else {
        const table = parseMarkdownHotspotTable(fullText)
        if (table != null && table.length > 0) {
          emitFromParsedJson('topics', table, emit)
        } else {
          const loose = parseLooseHotspotList(fullText)
          if (loose != null && loose.length > 0) {
            emitFromParsedJson('topics', loose, emit)
          }
        }
      }
    }
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

const COVER_TYPES = new Set(['photo', 'text', 'collage', 'compare', 'list'])

function platformFromHostname(hostname: string): string {
  const h = hostname.toLowerCase()
  if (h.includes('xiaohongshu') || h.includes('xhslink')) return '小红书'
  if (h.includes('weibo.com') || h === 'weibo.cn') return '微博'
  if (h.includes('douyin') || h.includes('iesdouyin')) return '抖音'
  if (h.includes('zhihu')) return '知乎'
  if (h.includes('bilibili')) return 'B站'
  return hostname || '链接'
}

function rowLooksLikeIdeashuV5Topics(o: Record<string, unknown>): boolean {
  if (typeof o.materialMatch === 'boolean') return true
  const timing = o.timing
  if (typeof timing === 'string' && (timing === 'hot' || timing === 'evergreen')) return true
  if (typeof o.source === 'string' && o.source.length > 0 && typeof o.title === 'string') {
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

  function publishedAtFrom(o: Record<string, unknown>) {
    const raw =
      typeof o.publishedAt === 'string'
        ? o.publishedAt.trim()
        : typeof o.sourcePublishedAt === 'string'
          ? o.sourcePublishedAt.trim()
          : ''
    return raw.length > 0 ? raw : undefined
  }

  return arr.map((item, i) => {
    const o = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const publishedAtOpt = publishedAtFrom(o)
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

      const heatFromO = typeof o.heatScore === 'number' ? o.heatScore : Number(o.heatScore)
      const heatScore =
        Number.isFinite(heatFromO) ? clamp(heatFromO, 0, 100) : materialMatch ? 88 : 58

      const lifecycleRawV5 = typeof o.lifecycle === 'string' ? o.lifecycle.trim() : ''
      const lifecycleFromJson: TrendSignal['lifecycle'] | null = [
        'emerging',
        'hot',
        'peak',
        'declining',
      ].includes(lifecycleRawV5)
        ? (lifecycleRawV5 as TrendSignal['lifecycle'])
        : null
      const lifecycle: TrendSignal['lifecycle'] =
        lifecycleFromJson ??
        (timing === 'evergreen' ? 'peak' : timing === 'hot' ? 'hot' : 'emerging')

      const angles = [angle, hook, timingDetail].map((s) => s.trim()).filter((s) => s.length > 0)

      let sourceUrlRaw = typeof o.sourceUrl === 'string' ? o.sourceUrl.trim() : ''
      const sourceStr = String(o.source ?? '').trim()
      if (!sourceUrlRaw && /^https?:\/\//i.test(sourceStr)) {
        try {
          const u = new URL(sourceStr)
          if (u.protocol === 'http:' || u.protocol === 'https:') sourceUrlRaw = u.href
        } catch {
          // ignore
        }
      }
      let sources: TrendSignal['sources'] = []
      let normalizedSourceUrl: string | undefined

      if (sourceUrlRaw) {
        try {
          const u = new URL(sourceUrlRaw)
          if (u.protocol === 'http:' || u.protocol === 'https:') {
            normalizedSourceUrl = u.href
            const looksLikeUrl = /^https?:\/\//i.test(source.trim())
            const platformFromField =
              source.trim().length > 0 && !looksLikeUrl ? source.trim() : platformFromHostname(u.hostname)
            const metricsParts = [angle, hook].map((s) => s.trim()).filter((s) => s.length > 0)
            const metrics = metricsParts.length > 0 ? metricsParts.join(' · ') : source || '—'
            sources = [{ platform: platformFromField, url: u.href, metrics }]
          }
        } catch {
          // invalid URL: leave sources empty
        }
      }

      return {
        id,
        keyword: title,
        title,
        heatScore,
        lifecycle,
        sources,
        suggestedAngles: angles.length > 0 ? angles : ['切入角度', '钩子'],
        topicSource: source,
        angle: angle || undefined,
        hook: hook || undefined,
        timing,
        timingDetail: timingDetail || undefined,
        materialMatch,
        materialCount: materialCountNorm,
        ...(normalizedSourceUrl ? { sourceUrl: normalizedSourceUrl } : {}),
        ...(publishedAtOpt ? { publishedAt: publishedAtOpt } : {}),
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
    let sources: TrendSignal['sources'] = Array.isArray(o.sources)
      ? (o.sources as TrendSignal['sources']).map((s) => ({ ...s }))
      : [{ platform: '小红书', metrics: '—' }]
    const sourceUrlTop = typeof o.sourceUrl === 'string' ? o.sourceUrl.trim() : ''
    let legacySourceUrl: string | undefined
    if (sourceUrlTop) {
      try {
        const u = new URL(sourceUrlTop)
        if (u.protocol === 'http:' || u.protocol === 'https:') {
          legacySourceUrl = u.href
          const first = sources[0] ?? { platform: '小红书', metrics: '—' }
          const hasUrl = typeof first.url === 'string' && first.url.trim().length > 0
          if (!hasUrl) {
            sources = [
              {
                ...first,
                url: u.href,
                platform:
                  typeof first.platform === 'string' && first.platform.trim().length > 0
                    ? first.platform
                    : platformFromHostname(u.hostname),
              },
              ...sources.slice(1),
            ]
          }
        }
      } catch {
        // ignore invalid URL
      }
    }
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
      ...(legacySourceUrl ? { sourceUrl: legacySourceUrl } : {}),
      ...(publishedAtOpt ? { publishedAt: publishedAtOpt } : {}),
    }
  })
}

/**
 * 已出现 json:topics 且围栏闭合，但当前仍抽不出 topics JSON（常见于网关连发多帧 chat+message，首帧只有前文、下一帧才补全代码块）。
 * 此时不应判为终态失败，应等后续帧或超时。
 */
export function looksLikeTopicsJsonPendingMore(raw: string): boolean {
  if (!/json:topics/i.test(raw)) return false
  const fences = raw.match(/```/g)
  if (!fences || fences.length % 2 !== 0) return true
  if (extractJsonBlocks(raw).topics !== undefined) return false
  if (extractTaggedJSON(raw, 'topics') != null) return false
  if (extractBareJsonTopicsArray(raw) != null) return false
  return true
}

/** Hotspot / UI fallback when `topics` event was not emitted but prose still contains machine JSON. */
export function parseTopicsFromAssistantRaw(raw: string): TrendSignal[] | null {
  const blocks = extractJsonBlocks(raw)
  if (blocks.topics !== undefined) {
    return finishTopicsWithTraceableFilter(normalizeTrendSignals(blocks.topics))
  }
  const bare = extractBareJsonTopicsArray(raw)
  if (bare) return finishTopicsWithTraceableFilter(normalizeTrendSignals(bare))
  const tagged = extractTaggedJSON(raw, 'topics')
  if (tagged != null) return finishTopicsWithTraceableFilter(normalizeTrendSignals(tagged))
  const looseArr = tryExtractJsonArrayFromText(raw)
  if (looseArr) return finishTopicsWithTraceableFilter(normalizeTrendSignals(looseArr))
  const table = parseMarkdownHotspotTable(raw)
  if (table != null && table.length > 0) return finishTopicsWithTraceableFilter(normalizeTrendSignals(table))
  const loose = parseLooseHotspotList(raw)
  if (loose != null && loose.length > 0) return finishTopicsWithTraceableFilter(normalizeTrendSignals(loose))
  return null
}

function assistantTextFromRecord(obj: Record<string, unknown>): string {
  /** Same frame may repeat prose in `text` + `delta` (cumulative vs delta); never concat blindly. */
  const slices: string[] = []
  if (typeof obj.text === 'string') slices.push(obj.text)
  if (typeof obj.content === 'string') slices.push(obj.content)
  if (typeof obj.delta === 'string') slices.push(obj.delta)
  if (typeof obj.output === 'string') slices.push(obj.output)
  const partList = obj.parts
  if (Array.isArray(partList)) {
    for (const part of partList) {
      if (part && typeof part === 'object') {
        const pr = part as Record<string, unknown>
        if (typeof pr.text === 'string') slices.push(pr.text)
        if (typeof pr.content === 'string') slices.push(pr.content)
      }
    }
  }
  let acc = ''
  for (const chunk of slices) {
    acc = mergeStreamTextChunk(acc, chunk)
  }
  return acc
}

/**
 * Single agent/chunk frame: one canonical text slice (delta or cumulative per gateway).
 */
function extractAgentChunkText(payload: unknown): string {
  if (payload == null || typeof payload !== 'object') return ''
  const p = payload as Record<string, unknown>

  const data = p.data
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const s = assistantTextFromRecord(data as Record<string, unknown>)
    if (s.length > 0) return s
  }

  if (typeof p.text === 'string') return p.text
  if (typeof p.message === 'string') return p.message
  if (p.message && typeof p.message === 'object') {
    const msg = assistantTextFromRecord(p.message as Record<string, unknown>)
    if (msg.length > 0) return msg
  }
  return ''
}

/**
 * Chat completion frame may include both a short `data` slice and a full `message` body.
 * Prefer the longest non-empty candidate so we do not parse a 4-char buffer while the full reply lives under `message`.
 */
function pickLongestAssistantTextFromChatPayload(payload: unknown): string {
  if (payload == null || typeof payload !== 'object') return ''
  const p = payload as Record<string, unknown>
  const candidates: string[] = []
  const push = (s: string) => {
    const t = s.trim()
    if (t.length > 0) candidates.push(s)
  }

  if (p.data && typeof p.data === 'object' && !Array.isArray(p.data)) {
    push(assistantTextFromRecord(p.data as Record<string, unknown>))
  }
  if (typeof p.text === 'string') push(p.text)
  if (typeof p.message === 'string') push(p.message)
  if (p.message && typeof p.message === 'object') {
    push(assistantTextFromRecord(p.message as Record<string, unknown>))
  }

  if (candidates.length === 0) return ''
  return candidates.reduce((a, b) => (a.length >= b.length ? a : b))
}

function normalizeDraftPayload(raw: unknown): Draft | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  let body: unknown = o.body
  if (Array.isArray(body)) body = (body as unknown[]).map((b) => String(b)).join('\n\n')
  const sanitizeNoAsterisks = (s: string) => s.replace(/\*/g, '')
  const bodyStr = sanitizeNoAsterisks(String(body ?? ''))
  const coverRaw =
    o.cover && typeof o.cover === 'object' ? (o.cover as Record<string, unknown>) : {}
  const t = String(coverRaw.type ?? 'photo')
  const coverType = COVER_TYPES.has(t) ? (t as Draft['cover']['type']) : 'photo'
  const status = o.status
  const draft: Draft = {
    title: sanitizeNoAsterisks(String(o.title ?? '')),
    body: bodyStr,
    tags: Array.isArray(o.tags)
      ? (o.tags as unknown[]).map((x) => sanitizeNoAsterisks(String(x)))
      : [],
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

function normalizeCoverPayload(raw: unknown): CoverPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const imageUrl = typeof o.imageUrl === 'string' ? o.imageUrl.trim() : ''
  if (!imageUrl) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[openclawClient] json:cover skipped: missing imageUrl')
    }
    return null
  }
  const isDataImage = imageUrl.startsWith('data:image/')
  let httpOk = false
  if (!isDataImage) {
    try {
      const u = new URL(imageUrl)
      httpOk = u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      httpOk = false
    }
    if (!httpOk) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[openclawClient] json:cover skipped: invalid imageUrl', imageUrl.slice(0, 96))
      }
      return null
    }
  }
  const modeRaw = String(o.mode ?? '')
  const mode: CoverPayload['mode'] = modeRaw === 'img2img' ? 'img2img' : 'text2img'
  const out: CoverPayload = { mode, imageUrl }
  if (typeof o.overlayText === 'string' && o.overlayText.trim().length > 0) {
    out.overlayText = o.overlayText.trim()
  }
  if (typeof o.prompt === 'string' && o.prompt.trim().length > 0) {
    out.prompt = o.prompt.trim()
  }
  const st = o.strength
  if (typeof st === 'number' && Number.isFinite(st)) out.strength = st
  else if (typeof st === 'string') {
    const n = Number(st)
    if (Number.isFinite(n)) out.strength = n
  }
  const it = o.iteration
  if (typeof it === 'number' && Number.isFinite(it)) out.iteration = it
  else if (typeof it === 'string') {
    const n = Number(it)
    if (Number.isFinite(n)) out.iteration = n
  }
  return out
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
  /** Successful token load only; failed loads do not cache so the next connect can retry. */
  let cachedOperatorAuth: { gatewayToken: string; deviceToken: string } | null = null
  let operatorAuthInFlight: Promise<{ gatewayToken: string; deviceToken: string } | null> | null = null

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

  /** When `assistant_reply` fires with zero listeners (e.g. React StrictMode gap), hold once for the next subscriber. */
  let undeliveredAssistantReply: Extract<OpenClawEvent, { type: 'assistant_reply' }> | null = null

  /** Survives component remounts so the UI can re-hydrate if StrictMode dropped setState. Cleared on send/connect/disconnect. */
  let lastAssistantReplySnapshot: Extract<OpenClawEvent, { type: 'assistant_reply' }> | null = null

  function notifyConnectionChange(ready: boolean) {
    connectionListeners.forEach((cb) => cb(ready))
  }

  let debugEventLogged = 0
  let debugAgentExtractLogged = 0
  let debugHealthLogged = 0
  let debugChatSendLogged = 0
  let debugAgentChatIngestCount = 0
  let debugPayloadJsonMismatchIngestCount = 0
  let debugParsedJsonIngestCount = 0

  // #region debug_mode_logging
  // Debug-only evidence logger (disabled by default for demo/production).
  // The local ingest server may be unavailable, so we intentionally no-op here.
  function postDebugLog(_params: {
    hypothesisId: string
    location: string
    message: string
    data?: Record<string, unknown>
    runId?: string
  }) {
    // no-op
  }
  // #endregion

  function emit(evt: OpenClawEvent) {
    if (evt.type === 'assistant_reply') {
      lastAssistantReplySnapshot = {
        type: 'assistant_reply',
        replyId: evt.replyId,
        text: evt.text,
        rawFull: evt.rawFull,
      }
      if (eventListeners.size === 0) {
        undeliveredAssistantReply = evt
        return
      }
      undeliveredAssistantReply = null
    }
    eventListeners.forEach((cb) => cb(evt))
  }

  /** Full assistant reply text: agent chunks append `payload.data.text`; chat + `message` flushes and parses ```json:*``` blocks. */
  let messageBuffer = ''
  /** First non-empty merged byte time for current agent stream segment (reset when buffer drained). */
  let agentStreamFirstChunkAt: number | null = null

  /**
   * Some gateways stream only `agent` events and never emit `chat` with `message`, so the buffer would
   * never flush. Schedule a parse after the stream goes idle (last agent chunk).
   *
   * 飞书等非流式场景一次到位；网页走 WS 流式时，模型在工具调用（搜索）之间可能静默 10s+。
   * 2s 空闲会误把开场白当终态 flush 掉，导致 json:topics 永远进不了同一次 parse。
   */
  let agentIdleFlushTimer: number | null = null
  /** Longer pause avoids treating mid-tool-call silence as end-of-message (still capped by AGENT_STREAM_FORCE_FLUSH_MS). */
  const AGENT_IDLE_FLUSH_MS = 60_000
  const AGENT_STREAM_FORCE_FLUSH_MS = 120_000

  function clearAgentIdleFlushTimer() {
    if (agentIdleFlushTimer != null) {
      window.clearTimeout(agentIdleFlushTimer)
      agentIdleFlushTimer = null
    }
  }

  function scheduleAgentIdleFlush() {
    clearAgentIdleFlushTimer()
    agentIdleFlushTimer = window.setTimeout(() => {
      agentIdleFlushTimer = null
      if (!messageBuffer.trim()) return
      const started = agentStreamFirstChunkAt
      const forceByAge =
        started != null && Date.now() - started >= AGENT_STREAM_FORCE_FLUSH_MS
      if (!forceByAge && bufferLooksLikeIncompleteJsonTopicsFence(messageBuffer)) {
        scheduleAgentIdleFlush()
        return
      }
      parseAndEmitMessageBuffer('agent_stream_idle', activeAssistantReplyId)
    }, AGENT_IDLE_FLUSH_MS)
  }

  /**
   * If structured topic data is present (fenced ```json:topics```, bare ```json``` array, or pipe table),
   * parse immediately instead of waiting for idle. Does not use parseLooseHotspotList — prose-only replies
   * must not trigger an early flush from section headings.
   */
  function tryFlushAgentBufferIfTopicsFenceComplete() {
    const text = messageBuffer
    if (!text.trim() || text.length < 40) return
    const blocks = extractJsonBlocks(text)
    let payload: unknown = blocks.topics
    if (payload === undefined) {
      const bare = extractBareJsonTopicsArray(text)
      if (bare) payload = bare
    }
    if (payload === undefined) {
      const table = parseMarkdownHotspotTable(text)
      if (table && table.length > 0) payload = table
    }
    if (payload === undefined) return
    const norm = normalizeTrendSignals(payload)
    if (!norm || norm.length === 0) return
    const forUi = finishTopicsWithTraceableFilter(norm)
    if (!forUi || forUi.length === 0) return
    parseAndEmitMessageBuffer('agent_stream+json_topics_fence', activeAssistantReplyId)
  }

  /** 同一次助手正文（规范化后）只解析/派发一次，避免 chat+message 重复帧 */
  let lastEmittedAssistantContentFingerprint: string | null = null

  /** reply identity used to update the same chat bubble record instead of pushing duplicates */
  let activeAssistantReplyId: string | null = null
  let fallbackAssistantReplySeq = 0

  /** Same visible prose after strip but `raw` grew (e.g. ```json:topics``` finished streaming) — still emit so Hotspot can parse final rawFull. */
  const lastRawFullEmittedByReplyId = new Map<string, string>()

  /** Skip `assistant_reply` when visible text matches last emit for this replyId (e.g. agent idle flush + chat+message). */
  const lastEmittedDisplayNormByReplyId = new Map<string, string>()

  function resetAssistantDedupe() {
    lastEmittedAssistantContentFingerprint = null
    activeAssistantReplyId = null
    lastRawFullEmittedByReplyId.clear()
    lastEmittedDisplayNormByReplyId.clear()
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
    clearAgentIdleFlushTimer()
    messageBuffer = ''
    agentStreamFirstChunkAt = null
  }

  function emitAssistantParse(raw: string, replyId: string): boolean {
    // 可见文案 fingerprint 可能不变但 raw 变长（如 json:topics 续写）：只要 raw 变就重跑结构化解析，避免少发 topics。
    const prevRawForReply = lastRawFullEmittedByReplyId.get(replyId)
    if (raw !== prevRawForReply) {
      emitJsonBlocksFromBuffer(raw, emit)
    }

    const contentFp = normalizeAssistantRawForFingerprint(raw)
    if (contentFp.length > 0 && contentFp === lastEmittedAssistantContentFingerprint) {
      lastRawFullEmittedByReplyId.set(replyId, raw)
      return false
    }
    lastEmittedAssistantContentFingerprint = contentFp

    let displayText = stripMachineJsonFromChatDisplay(raw)
    displayText = collapseDoubledAssistantProse(displayText)
    displayText = collapseConsecutiveDuplicateParagraphs(displayText)
    const displayNorm = displayText.replace(/\s+/g, ' ').trim()
    let emittedVisible = false
    if (displayNorm.length > 0) {
      const prevNorm = lastEmittedDisplayNormByReplyId.get(replyId)
      if (prevNorm === displayNorm) {
        lastRawFullEmittedByReplyId.set(replyId, raw)
        // eslint-disable-next-line no-console
        console.warn('[openclawClient] skip duplicate assistant_reply (same visible text for replyId; raw may differ)')
      } else {
        lastEmittedDisplayNormByReplyId.set(replyId, displayNorm)
        lastRawFullEmittedByReplyId.set(replyId, raw)
        emittedVisible = true
        emit({ type: 'assistant_reply', replyId, text: displayText, rawFull: raw })
      }
    }

    // Some skills reply with only machine-readable ```json:*``` blocks and no prose.
    // In demo/production UX, show a minimal assistant bubble so users know something happened.
    if (!emittedVisible) {
      const hasMachineJson = /```json:\w+/.test(raw) || /\bjson:\w+\b/.test(raw)
      if (hasMachineJson) {
        const fallback = '已生成结果（草稿/评分/原创度已更新）。'
        const fbNorm = fallback.replace(/\s+/g, ' ').trim()
        if (lastEmittedDisplayNormByReplyId.get(replyId) !== fbNorm) {
          lastEmittedDisplayNormByReplyId.set(replyId, fbNorm)
          lastRawFullEmittedByReplyId.set(replyId, raw)
          emit({ type: 'assistant_reply', replyId, text: fallback, rawFull: raw })
        } else {
          lastRawFullEmittedByReplyId.set(replyId, raw)
        }
      }
    }
    return true
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
    const rid =
      activeAssistantReplyId ?? replyId ?? `${sessionKey ?? 'nosession'}::fb_${fallbackAssistantReplySeq++}`
    if (activeAssistantReplyId == null) activeAssistantReplyId = rid
    emitAssistantParse(text, rid)
  }

  function parseAndEmitMessageBuffer(reason: string, replyId: string | null) {
    clearAgentIdleFlushTimer()
    const text = messageBuffer
    messageBuffer = ''
    agentStreamFirstChunkAt = null
    if (!text.trim()) return
    const rid =
      activeAssistantReplyId ?? replyId ?? `${sessionKey ?? 'nosession'}::fb_${fallbackAssistantReplySeq++}`
    if (activeAssistantReplyId == null) activeAssistantReplyId = rid
    const emitted = emitAssistantParse(text, rid)
    if (!emitted) return
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[openclawClient] buffer tail (last 500 chars):', text.slice(-500))
      // eslint-disable-next-line no-console
      console.log('[openclawClient] extractJsonBlocks result:', JSON.stringify(extractJsonBlocks(text)))
      // eslint-disable-next-line no-console
      console.log('[openclawClient] message complete, parse', reason, 'len=', text.length)
    }
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
    if (cachedOperatorAuth) return cachedOperatorAuth
    if (operatorAuthInFlight) return operatorAuthInFlight

    operatorAuthInFlight = (async () => {
      try {
        const resp = await fetch('/__openclaw_device_auth', { method: 'GET' })
        if (!resp.ok) return null
        const data = (await resp.json()) as any
        if (typeof data?.gatewayToken !== 'string') return null
        if (typeof data?.deviceToken !== 'string') return null
        cachedOperatorAuth = { gatewayToken: data.gatewayToken, deviceToken: data.deviceToken }
        return cachedOperatorAuth
      } catch {
        return null
      } finally {
        operatorAuthInFlight = null
      }
    })()

    return operatorAuthInFlight
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
    undeliveredAssistantReply = null
    lastAssistantReplySnapshot = null

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
            const chunk = extractAgentChunkText(payload)
            const wasEmpty = messageBuffer.length === 0
            messageBuffer = mergeStreamTextChunk(messageBuffer, chunk)
            if (messageBuffer.trim().length > 0 && agentStreamFirstChunkAt == null) {
              agentStreamFirstChunkAt = Date.now()
            }
            if (wasEmpty && activeAssistantReplyId == null) {
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
            tryFlushAgentBufferIfTopicsFenceComplete()
            scheduleAgentIdleFlush()
            return
          }

          if (evtName === 'chat') {
            const p = payload as Record<string, unknown> | null | undefined
            const hasMessage = p != null && typeof p === 'object' && 'message' in p && p.message != null
            if (hasMessage) {
              const fromChat = pickLongestAssistantTextFromChatPayload(payload)
              if (fromChat.length > messageBuffer.length) {
                messageBuffer = fromChat
              }
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
    cachedOperatorAuth = null
    pendingRes.clear()
    clearMessageBuffer()
    undeliveredAssistantReply = null
    lastAssistantReplySnapshot = null
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

  function resetAssistantStreamState() {
    clearMessageBuffer()
    undeliveredAssistantReply = null
    lastAssistantReplySnapshot = null
    resetAssistantDedupe()
  }

  function send(content: string): boolean {
    if (!isReady()) {
      // eslint-disable-next-line no-console
      console.warn('[openclawClient] send skipped: gateway not ready (no mock fallback)')
      return false
    }

    clearMessageBuffer()
    undeliveredAssistantReply = null
    lastAssistantReplySnapshot = null
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
    return true
  }

  return {
    connect,
    disconnect,
    send,
    resetAssistantStreamState,
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
      if (undeliveredAssistantReply) {
        const pending = undeliveredAssistantReply
        undeliveredAssistantReply = null
        cb(pending)
      }
      return () => {
        eventListeners.delete(cb)
      }
    },
    getLastAssistantReply: () => lastAssistantReplySnapshot,
  }
}

