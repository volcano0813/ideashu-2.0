import type { Draft, EditorStage } from '../components/XhsPostEditor'

export type MaterialType = 'text' | 'photo' | 'voice' | 'data'

export type Material = {
  id: string
  type: MaterialType
  content: string
  /** 图片类素材：压缩后的 JPEG data URL，存于 localStorage */
  imageDataUrl?: string
  topicTags: string[]
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

const MATERIALS_KEY = 'ideashu.materials.v1'
const POSTS_KEY = 'ideashu.posts.v1'
const DRAFT_SESSION_KEY = 'ideashu.draftSession.v1'
const PENDING_DRAFT_KEY = 'ideashu.pendingDraft.v1'
const STYLE_SAMPLES_KEY = 'ideashu.styleSamples.v1'
const PENDING_PUBLISH_KEY = 'ideashu.pendingPublish.v1'

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
  // Works in modern browsers; fallback for older environments.
  const cryptoObj = (globalThis as unknown as { crypto?: { randomUUID?: () => string } })
    .crypto
  if (cryptoObj?.randomUUID) return `${prefix}_${cryptoObj.randomUUID()}`
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`
}

const DEFAULT_MATERIALS: Material[] = [
  {
    id: 'mat_1',
    type: 'text',
    content: '我在吧台旁边等咖啡的 7 分钟，听见磨豆机的声音，然后突然想起“香气会让人慢下来”。',
    topicTags: ['咖啡探店', '氛围', '慢生活'],
    createdAt: '2026-03-20',
    usedInPosts: [],
  },
  {
    id: 'mat_2',
    type: 'photo',
    content: '手冲台特写：木纹+暖光，杯壁形成细腻的泡沫纹理，颜色像在呼吸。',
    topicTags: ['手冲', '暖光', '细节'],
    createdAt: '2026-03-18',
    usedInPosts: [],
  },
  {
    id: 'mat_3',
    type: 'voice',
    content: '店员说“今天豆子很香”，我顺手录下了那句，然后把语气和停顿一起写进笔记。',
    topicTags: ['豆子', '店员', '原生表达'],
    createdAt: '2026-03-16',
    usedInPosts: [],
  },
  {
    id: 'mat_4',
    type: 'data',
    content: '同价位对比记录：从豆子来源到出品稳定性，我总结了 3 个“可复来”的指标。',
    topicTags: ['竞品', '价格', '复购'],
    createdAt: '2026-03-14',
    usedInPosts: [],
  },
  {
    id: 'mat_5',
    type: 'text',
    content: '甜品搭配：酸度更柔和，甜而不腻；我把“入口第一秒的变化”写成一句钩子。',
    topicTags: ['甜品', '搭配', '口感'],
    createdAt: '2026-03-12',
    usedInPosts: [],
  },
  {
    id: 'mat_6',
    type: 'photo',
    content: '菜单边角和桌面反光：光线从柜台侧面斜进来，拍出来会有一点“电影感”。',
    topicTags: ['光影', '桌面', '画面感'],
    createdAt: '2026-03-10',
    usedInPosts: [],
  },
]

export function loadMaterials(): Material[] {
  const parsed = safeParseJSON<Material[]>(localStorage.getItem(MATERIALS_KEY))
  if (parsed && Array.isArray(parsed) && parsed.length > 0) return parsed
  localStorage.setItem(MATERIALS_KEY, JSON.stringify(DEFAULT_MATERIALS))
  return DEFAULT_MATERIALS
}

export function addMaterial(input: Omit<Material, 'id' | 'createdAt' | 'usedInPosts'>) {
  const materials = loadMaterials()
  const mat: Material = {
    ...input,
    id: uid('mat'),
    createdAt: todayStr(),
    usedInPosts: [],
  }
  materials.unshift(mat)
  localStorage.setItem(MATERIALS_KEY, JSON.stringify(materials))
  return mat
}

export function deleteMaterial(id: string) {
  const materials = loadMaterials()
  const next = materials.filter((m) => m.id !== id)
  localStorage.setItem(MATERIALS_KEY, JSON.stringify(next))
}

export function loadPosts(): KnowledgePost[] {
  const parsed = safeParseJSON<KnowledgePost[]>(localStorage.getItem(POSTS_KEY))
  if (parsed && Array.isArray(parsed)) return parsed
  return []
}

export function savePost(post: KnowledgePost) {
  const posts = loadPosts()
  const idx = posts.findIndex((p) => p.id === post.id)
  const next = [...posts]
  if (idx >= 0) next[idx] = post
  else next.unshift(post)
  localStorage.setItem(POSTS_KEY, JSON.stringify(next))
}

export function loadStyleSamples(): StyleSample[] {
  const parsed = safeParseJSON<StyleSample[]>(localStorage.getItem(STYLE_SAMPLES_KEY))
  if (parsed && Array.isArray(parsed)) return parsed
  return []
}

export function addStyleSample(input: Omit<StyleSample, 'id' | 'createdAt'>): StyleSample {
  const samples = loadStyleSamples()
  const item: StyleSample = {
    ...input,
    id: uid('style'),
    createdAt: new Date().toISOString(),
  }
  samples.unshift(item)
  localStorage.setItem(STYLE_SAMPLES_KEY, JSON.stringify(samples))
  return item
}

export function addStyleSampleFromPost(post: KnowledgePost): StyleSample | null {
  // Count any saved post as a "图文样本":
  // - cover may be a real image or only a textual/overlay cover (demo/early stage).
  // - the important part is that title/body/tags + cover exist.
  if (!post.title.trim() || !post.body.trim()) return null
  return addStyleSample({
    title: post.title,
    body: post.body,
    tags: post.tags,
    cover: post.cover,
  })
}

export function loadDraftSession(): DraftSession | null {
  const parsed = safeParseJSON<DraftSession>(localStorage.getItem(DRAFT_SESSION_KEY))
  return parsed ?? null
}

export function saveDraftSession(session: DraftSession) {
  localStorage.setItem(DRAFT_SESSION_KEY, JSON.stringify(session))
}

export function clearDraftSession() {
  localStorage.removeItem(DRAFT_SESSION_KEY)
}

export function setPendingDraft(draft: Draft) {
  localStorage.setItem(PENDING_DRAFT_KEY, JSON.stringify(draft))
}

export function consumePendingDraft(): Draft | null {
  const raw = localStorage.getItem(PENDING_DRAFT_KEY)
  if (!raw) return null
  localStorage.removeItem(PENDING_DRAFT_KEY)
  return safeParseJSON<Draft>(raw)
}

export function setPendingPublish(pending: PendingPublish) {
  localStorage.setItem(PENDING_PUBLISH_KEY, JSON.stringify(pending))
}

export function consumePendingPublish(): PendingPublish | null {
  const raw = localStorage.getItem(PENDING_PUBLISH_KEY)
  if (!raw) return null
  localStorage.removeItem(PENDING_PUBLISH_KEY)
  return safeParseJSON<PendingPublish>(raw)
}

export function uidForPost() {
  return uid('post')
}

