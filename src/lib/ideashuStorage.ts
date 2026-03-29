import type { Draft, EditorStage } from '../components/XhsPostEditor'
import { MOCK_ACCOUNTS, normalizeAccountFields, type Account } from './accounts'

export const ACTIVE_ACCOUNT_KEY = 'ideashu.activeAccountId.v1'

export type MaterialType = 'text' | 'photo' | 'voice' | 'data'

export type Material = {
  id: string
  type: MaterialType
  content: string
  /** 图片类素材：压缩后的 JPEG data URL，存于 localStorage */
  imageDataUrl?: string
  topicTags: string[]
  /** 用于灵感库演示配色：琥珀/天蓝/玫瑰/薄荷/紫丁香/金黄（按索引 0-5） */
  tintIndex?: number
  createdAt: string // YYYY-MM-DD
  usedInPosts: string[]
}

export type EditRecord = {
  id: string
  postId: string
  timestamp: string // ISO string
  location: 'title' | 'body' | 'tags' | 'cover'
  original: string
  modified: string
  editType: 'word_replace' | 'sentence_adjust' | 'delete' | 'add_detail' | 'tone_change' | 'restructure'
}

export type DraftSession = {
  postId: string
  stage: EditorStage
  originalDraft: Draft
  draft: Draft
  editHistory: EditRecord[]
  createdAt: string // ISO string
  updatedAt: string // ISO string
}

export type KnowledgePost = {
  id: string
  status: 'draft' | 'reviewed' | 'finalized' | 'published'
  title: string
  body: string
  tags: string[]
  cover: Draft['cover']
  originalDraft: Draft
  editHistory: EditRecord[]
  createdAt: string
  updatedAt: string
}

export type StyleSample = {
  id: string
  createdAt: string // ISO string
  title: string
  body: string
  tags: string[]
  cover: Draft['cover']
}

export type PendingPublish = {
  id: string
  status: KnowledgePost['status']
  draft: Draft
  originalDraft: Draft
  editHistory: EditRecord[]
  createdAt: string
  updatedAt: string
}

/** Pre–per-account keys (one-time migration) */
const LEGACY_MATERIALS_KEY = 'ideashu.materials.v1'
const LEGACY_POSTS_KEY = 'ideashu.posts.v1'
const LEGACY_DRAFT_SESSION_KEY = 'ideashu.draftSession.v1'
const LEGACY_PENDING_DRAFT_KEY = 'ideashu.pendingDraft.v1'
const LEGACY_STYLE_SAMPLES_KEY = 'ideashu.styleSamples.v1'
const LEGACY_PENDING_PUBLISH_KEY = 'ideashu.pendingPublish.v1'

const MIGRATION_FLAG_KEY = 'ideashu.migratedLegacy.v2'
const DEDUPE_LEGACY_COPIES_FLAG_KEY = 'ideashu.dedupedLegacyCopies.v1'

const ACCOUNTS_KEY = 'ideashu.accounts.v1'

function materialsKey(accountId: string) {
  return `ideashu.materials.${accountId}.v2`
}
function postsKey(accountId: string) {
  return `ideashu.posts.${accountId}.v2`
}
function draftSessionKey(accountId: string) {
  return `ideashu.draftSession.${accountId}.v2`
}
function pendingDraftKey(accountId: string) {
  return `ideashu.pendingDraft.${accountId}.v2`
}
function styleSamplesKey(accountId: string) {
  return `ideashu.styleSamples.${accountId}.v2`
}
function pendingPublishKey(accountId: string) {
  return `ideashu.pendingPublish.${accountId}.v2`
}

function safeParseJSON<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function todayStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function uid(prefix = 'id') {
  const cryptoObj = (globalThis as unknown as { crypto?: { randomUUID?: () => string } })
    .crypto
  if (cryptoObj?.randomUUID) return `${prefix}_${cryptoObj.randomUUID()}`
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`
}

function migrateLegacyToPerAccount(accounts: Account[]) {
  try {
    if (localStorage.getItem(MIGRATION_FLAG_KEY) === '1') return

    const legacyKeys = [
      LEGACY_MATERIALS_KEY,
      LEGACY_POSTS_KEY,
      LEGACY_DRAFT_SESSION_KEY,
      LEGACY_PENDING_DRAFT_KEY,
      LEGACY_STYLE_SAMPLES_KEY,
      LEGACY_PENDING_PUBLISH_KEY,
    ]
    const hasLegacy = legacyKeys.some((k) => localStorage.getItem(k) !== null)
    if (!hasLegacy) {
      localStorage.setItem(MIGRATION_FLAG_KEY, '1')
      return
    }

    const lm = localStorage.getItem(LEGACY_MATERIALS_KEY)
    const lp = localStorage.getItem(LEGACY_POSTS_KEY)
    const ld = localStorage.getItem(LEGACY_DRAFT_SESSION_KEY)
    const lpd = localStorage.getItem(LEGACY_PENDING_DRAFT_KEY)
    const ls = localStorage.getItem(LEGACY_STYLE_SAMPLES_KEY)
    const lpp = localStorage.getItem(LEGACY_PENDING_PUBLISH_KEY)

    for (const a of accounts) {
      const id = a.id
      if (!localStorage.getItem(materialsKey(id)) && lm != null) {
        localStorage.setItem(materialsKey(id), lm)
      }
      if (!localStorage.getItem(postsKey(id)) && lp != null) {
        localStorage.setItem(postsKey(id), lp)
      }
      if (!localStorage.getItem(draftSessionKey(id)) && ld != null) {
        localStorage.setItem(draftSessionKey(id), ld)
      }
      if (!localStorage.getItem(pendingDraftKey(id)) && lpd != null) {
        localStorage.setItem(pendingDraftKey(id), lpd)
      }
      if (!localStorage.getItem(styleSamplesKey(id)) && ls != null) {
        localStorage.setItem(styleSamplesKey(id), ls)
      }
      if (!localStorage.getItem(pendingPublishKey(id)) && lpp != null) {
        localStorage.setItem(pendingPublishKey(id), lpp)
      }
    }

    for (const k of legacyKeys) {
      localStorage.removeItem(k)
    }
    localStorage.setItem(MIGRATION_FLAG_KEY, '1')
  } catch {
    // ignore quota / private mode
  }
}

/**
 * One-time cleanup for an old migration behavior that copied the same legacy
 * data to every account bucket. We keep the owner account's data (prefer
 * "每日一杯"), and clear only buckets that are byte-equal copies.
 */
function cleanupDuplicatedLegacyCopies(accounts: Account[]) {
  try {
    if (localStorage.getItem(DEDUPE_LEGACY_COPIES_FLAG_KEY) === '1') return
    if (!accounts.length) {
      localStorage.setItem(DEDUPE_LEGACY_COPIES_FLAG_KEY, '1')
      return
    }

    const owner =
      accounts.find((a) => (a.name ?? '').replace(/\*/g, '').trim() === '每日一杯') ?? accounts[0]
    if (!owner) {
      localStorage.setItem(DEDUPE_LEGACY_COPIES_FLAG_KEY, '1')
      return
    }

    const ownerMaterials = localStorage.getItem(materialsKey(owner.id))
    const ownerPosts = localStorage.getItem(postsKey(owner.id))
    const ownerStyleSamples = localStorage.getItem(styleSamplesKey(owner.id))
    const ownerDraftSession = localStorage.getItem(draftSessionKey(owner.id))
    const ownerPendingDraft = localStorage.getItem(pendingDraftKey(owner.id))
    const ownerPendingPublish = localStorage.getItem(pendingPublishKey(owner.id))

    for (const a of accounts) {
      if (a.id === owner.id) continue

      const mk = materialsKey(a.id)
      const pk = postsKey(a.id)
      const sk = styleSamplesKey(a.id)
      const dk = draftSessionKey(a.id)
      const pdk = pendingDraftKey(a.id)
      const ppk = pendingPublishKey(a.id)

      if (ownerMaterials != null && localStorage.getItem(mk) === ownerMaterials) {
        localStorage.setItem(mk, JSON.stringify([]))
      }
      if (ownerPosts != null && localStorage.getItem(pk) === ownerPosts) {
        localStorage.setItem(pk, JSON.stringify([]))
      }
      if (ownerStyleSamples != null && localStorage.getItem(sk) === ownerStyleSamples) {
        localStorage.setItem(sk, JSON.stringify([]))
      }
      if (ownerDraftSession != null && localStorage.getItem(dk) === ownerDraftSession) {
        localStorage.removeItem(dk)
      }
      if (ownerPendingDraft != null && localStorage.getItem(pdk) === ownerPendingDraft) {
        localStorage.removeItem(pdk)
      }
      if (ownerPendingPublish != null && localStorage.getItem(ppk) === ownerPendingPublish) {
        localStorage.removeItem(ppk)
      }
    }

    localStorage.setItem(DEDUPE_LEGACY_COPIES_FLAG_KEY, '1')
  } catch {
    // ignore quota / private mode
  }
}

export function loadMaterials(accountId: string): Material[] {
  if (!accountId) return []
  const parsed = safeParseJSON<Material[]>(localStorage.getItem(materialsKey(accountId)))
  if (parsed && Array.isArray(parsed)) return parsed
  try {
    localStorage.setItem(materialsKey(accountId), JSON.stringify([]))
  } catch {
    // ignore
  }
  return []
}

export function addMaterial(
  accountId: string,
  input: Omit<Material, 'id' | 'createdAt' | 'usedInPosts'>,
) {
  const materials = loadMaterials(accountId)
  const mat: Material = {
    ...input,
    id: uid('mat'),
    createdAt: todayStr(),
    usedInPosts: [],
  }
  materials.unshift(mat)
  try {
    localStorage.setItem(materialsKey(accountId), JSON.stringify(materials))
  } catch {
    // ignore
  }
  return mat
}

export function updateMaterial(
  accountId: string,
  id: string,
  patch: Partial<Omit<Material, 'id' | 'createdAt' | 'usedInPosts'>>,
) {
  const materials = loadMaterials(accountId)
  const idx = materials.findIndex((m) => m.id === id)
  if (idx < 0) return
  const cur = materials[idx]
  const merged: Material = { ...cur, ...patch }
  if (merged.type === 'text') {
    delete merged.imageDataUrl
  }
  const next = [...materials]
  next[idx] = merged
  try {
    localStorage.setItem(materialsKey(accountId), JSON.stringify(next))
  } catch {
    // ignore
  }
}

export function deleteMaterial(accountId: string, id: string) {
  const materials = loadMaterials(accountId)
  const next = materials.filter((m) => m.id !== id)
  try {
    localStorage.setItem(materialsKey(accountId), JSON.stringify(next))
  } catch {
    // ignore
  }
}

export function loadPosts(accountId: string): KnowledgePost[] {
  if (!accountId) return []
  const parsed = safeParseJSON<KnowledgePost[]>(localStorage.getItem(postsKey(accountId)))
  if (parsed && Array.isArray(parsed)) return parsed
  return []
}

export function savePost(accountId: string, post: KnowledgePost) {
  const posts = loadPosts(accountId)
  const idx = posts.findIndex((p) => p.id === post.id)
  const next = [...posts]
  if (idx >= 0) next[idx] = post
  else next.unshift(post)
  try {
    localStorage.setItem(postsKey(accountId), JSON.stringify(next))
  } catch {
    // ignore
  }
}

export function deletePost(accountId: string, id: string) {
  const posts = loadPosts(accountId)
  const next = posts.filter((p) => p.id !== id)
  try {
    localStorage.setItem(postsKey(accountId), JSON.stringify(next))
  } catch {
    // ignore
  }
}

export function loadStyleSamples(accountId: string): StyleSample[] {
  if (!accountId) return []
  const parsed = safeParseJSON<StyleSample[]>(localStorage.getItem(styleSamplesKey(accountId)))
  if (parsed && Array.isArray(parsed)) return parsed
  return []
}

export function addStyleSample(
  accountId: string,
  input: Omit<StyleSample, 'id' | 'createdAt'>,
): StyleSample {
  const samples = loadStyleSamples(accountId)
  const item: StyleSample = {
    ...input,
    id: uid('style'),
    createdAt: new Date().toISOString(),
  }
  samples.unshift(item)
  try {
    localStorage.setItem(styleSamplesKey(accountId), JSON.stringify(samples))
  } catch {
    // ignore
  }
  return item
}

export function addStyleSampleFromPost(accountId: string, post: KnowledgePost): StyleSample | null {
  if (!post.title.trim() || !post.body.trim()) return null
  return addStyleSample(accountId, {
    title: post.title,
    body: post.body,
    tags: post.tags,
    cover: post.cover,
  })
}

export function loadDraftSession(accountId: string): DraftSession | null {
  if (!accountId) return null
  const parsed = safeParseJSON<DraftSession>(localStorage.getItem(draftSessionKey(accountId)))
  return parsed ?? null
}

export function saveDraftSession(accountId: string, session: DraftSession) {
  if (!accountId) return
  try {
    localStorage.setItem(draftSessionKey(accountId), JSON.stringify(session))
  } catch {
    // ignore
  }
}

export function clearDraftSession(accountId: string) {
  if (!accountId) return
  try {
    localStorage.removeItem(draftSessionKey(accountId))
  } catch {
    // ignore
  }
}

export function setPendingDraft(accountId: string, draft: Draft) {
  if (!accountId) return
  try {
    localStorage.setItem(pendingDraftKey(accountId), JSON.stringify(draft))
  } catch {
    // ignore
  }
}

/** Read pending draft without removing (e.g. before deferred consume in Strict Mode). */
export function peekPendingDraft(accountId: string): Draft | null {
  if (!accountId) return null
  return safeParseJSON<Draft>(localStorage.getItem(pendingDraftKey(accountId)))
}

export function consumePendingDraft(accountId: string): Draft | null {
  if (!accountId) return null
  const raw = localStorage.getItem(pendingDraftKey(accountId))
  if (!raw) return null
  const parsed = safeParseJSON<Draft>(raw)
  try {
    localStorage.removeItem(pendingDraftKey(accountId))
  } catch {
    // ignore
  }
  return parsed
}

export function setPendingPublish(accountId: string, pending: PendingPublish) {
  if (!accountId) return
  try {
    localStorage.setItem(pendingPublishKey(accountId), JSON.stringify(pending))
  } catch {
    // ignore
  }
}

export function consumePendingPublish(accountId: string): PendingPublish | null {
  if (!accountId) return null
  const raw = localStorage.getItem(pendingPublishKey(accountId))
  if (!raw) return null
  try {
    localStorage.removeItem(pendingPublishKey(accountId))
  } catch {
    // ignore
  }
  return safeParseJSON<PendingPublish>(raw)
}

export function uidForPost() {
  return uid('post')
}

export function loadAccounts(): Account[] {
  const parsed = safeParseJSON<Account[]>(localStorage.getItem(ACCOUNTS_KEY))
  if (parsed && Array.isArray(parsed) && parsed.length > 0) {
    const mapped = parsed.map((a) => normalizeAccountFields(a))
    const dirty = mapped.some((a, i) => parsed[i]?.name !== a.name)
    if (dirty) saveAccounts(mapped)
    migrateLegacyToPerAccount(mapped)
    cleanupDuplicatedLegacyCopies(mapped)
    return mapped
  }
  const seed = [...MOCK_ACCOUNTS].map((a) => normalizeAccountFields(a))
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(seed))
  } catch {
    // ignore
  }
  migrateLegacyToPerAccount(seed)
  cleanupDuplicatedLegacyCopies(seed)
  return seed
}

export function saveAccounts(accounts: Account[]) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
  } catch {
    // ignore quota / private mode
  }
}
