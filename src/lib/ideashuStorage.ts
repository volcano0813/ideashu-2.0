import type { Draft, EditorStage } from '../components/XhsPostEditor'
import { MOCK_ACCOUNTS, normalizeAccountFields, type Account } from './accounts'

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

const MATERIALS_KEY = 'ideashu.materials.v1'
const POSTS_KEY = 'ideashu.posts.v1'
const DRAFT_SESSION_KEY = 'ideashu.draftSession.v1'
const PENDING_DRAFT_KEY = 'ideashu.pendingDraft.v1'
const STYLE_SAMPLES_KEY = 'ideashu.styleSamples.v1'
const PENDING_PUBLISH_KEY = 'ideashu.pendingPublish.v1'
const ACCOUNTS_KEY = 'ideashu.accounts.v1'

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
    content: `下午3点的光是最好的。从落地窗斜进来，刚好打在吧台的原木台面上，手冲壶的不锈钢反射出一小片光斑在天花板上晃。店主说他当初选这个铺面就是因为这扇窗——朝西南，下午的光能从2点一直晒到5点半。`,
    topicTags: ['光影', '白天', '吧台'],
    tintIndex: 0,
    createdAt: '2026-03-26',
    usedInPosts: [],
  },
  {
    id: 'mat_2',
    type: 'text',
    content: `7点是最有意思的时刻。店主开始收咖啡器具，她开始从吧台下面拿出酒瓶。灯从白光慢慢调成暖黄，墙上那排搁板的射灯亮起来，酒瓶的颜色一下子就出来了——琥珀色、翠绿色、透明的。上一秒还是咖啡馆，10分钟后完全变了。最后走的那个写代码的男生抬头看了一眼，说'我以为换了一家店'。`,
    topicTags: ['切换', '夜晚', '反差'],
    tintIndex: 1,
    createdAt: '2026-03-25',
    usedInPosts: [],
  },
  {
    id: 'mat_3',
    type: 'text',
    content: `今天试了他们新上的「深圳迟早」——名字来自'深圳迟早会下雨'这个梗。用的是云南的日晒豆，中浅烘，手冲出来有很明显的莓果酸，但尾韵是巧克力味的，很暖。38块，量不大但值这个味道。店主说这个豆子只做了5公斤，卖完就没了。`,
    topicTags: ['咖啡', '手冲', '限定'],
    tintIndex: 2,
    createdAt: '2026-03-24',
    usedInPosts: [],
  },
  {
    id: 'mat_4',
    type: 'text',
    content: `她调酒的时候不看配方，说是'凭手感'。今天给我调了一杯没有名字的——金酒打底，加了茉莉花糖浆和一点青柠，上面飘了一片薄荷叶。入口是花香，然后是酒的劲，最后嘴里留下青柠的凉。她说这杯叫'还没想好'。58块。`,
    topicTags: ['调酒', '夜晚', '人物'],
    tintIndex: 3,
    createdAt: '2026-03-23',
    usedInPosts: [],
  },
  {
    id: 'mat_5',
    type: 'text',
    content: `拍了两张同一个角度的照片。一张是下午4点，阳光打在木桌上，桌上放着一杯手冲和一本摊开的书。另一张是晚上9点，同一张桌子，灯光暗了，桌上变成一杯冒着烟雾的鸡尾酒和一个手机架（在放歌）。发给朋友看，她说'这真的是同一个地方？'`,
    topicTags: ['反差', '白天vs夜晚', '视觉'],
    tintIndex: 4,
    createdAt: '2026-03-22',
    usedInPosts: [],
  },
  {
    id: 'mat_6',
    type: 'text',
    content: `和店主聊了一会。他之前在互联网公司做产品经理，她在4A广告公司做创意。两个人都30岁那年辞职了。他说'做咖啡是因为想要一个每天能看到阳光的工作'，她说'调酒是因为晚上的人更容易说真话'。他们没有合伙人，装修是自己设计的，菜单是自己写的，连门口的手写黑板都是她的字。`,
    topicTags: ['人物', '店主', '故事'],
    tintIndex: 5,
    createdAt: '2026-03-21',
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

export function updateMaterial(
  id: string,
  patch: Partial<Omit<Material, 'id' | 'createdAt' | 'usedInPosts'>>,
) {
  const materials = loadMaterials()
  const idx = materials.findIndex((m) => m.id === id)
  if (idx < 0) return
  const cur = materials[idx]
  const merged: Material = { ...cur, ...patch }
  if (merged.type === 'text') {
    delete merged.imageDataUrl
  }
  const next = [...materials]
  next[idx] = merged
  localStorage.setItem(MATERIALS_KEY, JSON.stringify(next))
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

export function deletePost(id: string) {
  const posts = loadPosts()
  const next = posts.filter((p) => p.id !== id)
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

export function loadAccounts(): Account[] {
  const parsed = safeParseJSON<Account[]>(localStorage.getItem(ACCOUNTS_KEY))
  if (parsed && Array.isArray(parsed) && parsed.length > 0) {
    const mapped = parsed.map((a) => normalizeAccountFields(a))
    const dirty = mapped.some((a, i) => parsed[i]?.name !== a.name)
    if (dirty) saveAccounts(mapped)
    return mapped
  }
  const seed = [...MOCK_ACCOUNTS].map((a) => normalizeAccountFields(a))
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(seed))
  } catch {
    // ignore
  }
  return seed
}

export function saveAccounts(accounts: Account[]) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
  } catch {
    // ignore quota / private mode
  }
}

