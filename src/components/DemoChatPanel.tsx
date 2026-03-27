import { marked } from 'marked'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fileToCompressedDataUrl } from '../lib/imageCompress'

export type ChatMessage = {
  id: string
  role: 'user' | 'agent'
  content: string
  /** 仅本机展示：随消息附带的图片（已写入素材库） */
  localImageDataUrl?: string
  loading?: boolean
}

export type TopicCardModel = {
  id: string
  title: string
  /** 一行简短说明（来源/角度等） */
  description: string
  recommended?: boolean
}

export type WelcomeAction = {
  id: string
  label: string
  hint?: string
  /** 发往网关的完整用户消息 */
  send: string
}

const DEFAULT_ACCOUNT_NAME = '每日一杯'

const DEFAULT_WELCOME_LEAD = `好的！我是 IdeaShu ☕️，帮你把真实体验打磨成小红书笔记。

开始之前，先告诉我两件事：
1. 你要为哪个账号创作？
（告诉我账号名或领域，比如「咖啡探店」「护肤科普」「数码测评」等）
2. 你今天想做什么？`

const DEFAULT_WELCOME_ACTIONS: WelcomeAction[] = [
  {
    id: 'hot_fetch',
    label: '🔥 找热点',
    hint: '抓取热点并一键带回创作',
    send: '__NAVIGATE__/hot-fetch',
  },
  {
    id: 'store_material',
    label: '📦 存素材',
    hint: '记录一段体验 / 感受 / 数据',
    send: '我想先存素材：记录一段体验、感受或数据，请按 ideashu / ideashu-v5 的流程引导我。',
  },
  {
    id: 'polish_draft',
    label: '✏️ 帮我改',
    hint: '你有粗稿，我来润色',
    send: '我已有粗稿，请帮我润色成适合小红书发布的笔记，可结合 ideashu-v5 skill。',
  },
  {
    id: 'write_full',
    label: '📝 帮我写',
    hint: '从选题开始，我辅助你创作',
    send: '用 ideashu-v5 skill 帮我写',
  },
  {
    id: 'new_account',
    label: '⚙️ 新建账号',
    hint: '第一次用，帮我配置一个新账号',
    send: '我是第一次用，请帮我新建账号配置：从零开始建立用户画像与创作习惯（阶段零）。',
  },
]

// Ensure JSON machine blocks never render into chat bubbles (even if upstream stripping missed).
function stripJsonBlocks(text: string): string {
  return text
    .replace(/```json:\w+\s*[\s\S]*?```/g, '')
    .replace(/```json\s*[\s\S]*?```/g, '')
    .trim()
}

function MarkdownBubble({ text, role }: { text: string; role: 'user' | 'agent' }) {
  const html = useMemo(() => {
    const raw = text?.trim() ? text : '_（无文本）_'
    const out = marked.parse(raw)
    return typeof out === 'string' ? out : String(out)
  }, [text])

  const base =
    role === 'user'
      ? 'text-[13px] leading-relaxed text-white [&_a]:text-white/90 [&_p]:my-0 [&_p+p]:mt-2 [&_strong]:text-white [&_code]:bg-white/20 [&_code]:text-white'
      : 'text-[13px] leading-relaxed text-text-main [&_a]:text-primary [&_p]:my-0 [&_p+p]:mt-2'

  return <div className={base} dangerouslySetInnerHTML={{ __html: html }} />
}

export default function DemoChatPanel({
  messages,
  topicCards,
  onSend,
  sending = false,
  gatewayError = false,
  accountName = DEFAULT_ACCOUNT_NAME,
  welcomeLead = DEFAULT_WELCOME_LEAD,
  welcomeActions = DEFAULT_WELCOME_ACTIONS,
}: {
  messages: ChatMessage[]
  topicCards?: TopicCardModel[]
  onSend: (text: string, options?: { imageDataUrl?: string }) => void
  sending?: boolean
  gatewayError?: boolean
  /** 当前创作账号展示名 */
  accountName?: string
  /** 首屏欢迎区多行正文 */
  welcomeLead?: string
  welcomeActions?: WelcomeAction[]
}) {
  const [input, setInput] = useState('')
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  function handleWelcomeActionSend(send: string) {
    if (send.startsWith('__NAVIGATE__/')) {
      navigate(send.replace('__NAVIGATE__', ''))
      return
    }
    onSend(send)
  }

  function submit() {
    const t = input.trim()
    if ((!t && !pendingImage) || sending) return
    const img = pendingImage
    setInput('')
    setPendingImage(null)
    onSend(t, { imageDataUrl: img ?? undefined })
  }

  return (
    <div className="h-full flex flex-col min-h-0 font-sans">
      <div className="shrink-0 border-b border-border-muted px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-text-main">对话</span>
        </div>
        {gatewayError ? (
          <div className="mt-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
            无法连接 OpenClaw Gateway（ws://127.0.0.1:18789）。请启动网关后刷新页面。
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {messages.length === 0 ? (
          <div className="rounded-[14px] border border-border-muted bg-surface px-3.5 py-3 shadow-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">当前账号</span>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[12px] font-semibold text-primary">
                {accountName}
              </span>
            </div>
            <div className="mt-2.5 text-[12px] leading-relaxed text-text-main whitespace-pre-line">{welcomeLead}</div>
            <p className="mt-3 text-[11px] text-text-tertiary">点选一项即可；也可在下方输入框先写账号名或领域，再点按钮。</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {welcomeActions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  disabled={gatewayError || sending}
                  onClick={() => handleWelcomeActionSend(a.send)}
                  className="w-full rounded-[12px] border border-border-muted bg-canvas px-3.5 py-2.5 text-left text-text-main shadow-sm transition-colors hover:border-primary/30 hover:bg-surface active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-1"
                >
                  <div className="text-[13px] font-semibold text-text-main">{a.label}</div>
                  {a.hint ? <div className="mt-0.5 text-[11px] leading-snug text-text-secondary">{a.hint}</div> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === 'user' ? 'flex justify-end' : 'flex justify-start'
            }
          >
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[85%] rounded-[14px] rounded-br-md bg-primary px-3.5 py-2.5 shadow-sm'
                  : 'max-w-[85%] rounded-[14px] rounded-bl-md bg-[#F5F5F5] px-3.5 py-2.5 text-text-main'
              }
            >
              {m.role === 'agent' ? (
                <div className="max-h-[min(42vh,320px)] overflow-y-auto overflow-x-hidden pr-0.5">
                  <MarkdownBubble text={stripJsonBlocks(m.content)} role="agent" />
                </div>
              ) : (
                <>
                  {m.localImageDataUrl ? (
                    <div className="mb-2 overflow-hidden rounded-[10px] border border-white/25">
                      <img
                        src={m.localImageDataUrl}
                        alt=""
                        className="max-h-48 w-full max-w-[260px] object-cover"
                      />
                    </div>
                  ) : null}
                  {m.content?.trim() ? (
                    <MarkdownBubble text={stripJsonBlocks(m.content)} role="user" />
                  ) : null}
                </>
              )}

              {m.loading ? (
                <div
                  className={
                    m.role === 'user'
                      ? 'mt-2 flex items-center gap-2 text-xs text-white/90'
                      : 'mt-2 flex items-center gap-2 text-xs text-text-secondary'
                  }
                >
                  <span
                    className={
                      m.role === 'user'
                        ? 'inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-white border-t-transparent animate-spin'
                        : 'inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-primary border-t-transparent animate-spin'
                    }
                    aria-hidden
                  />
                  <span className="font-medium">发送中…</span>
                </div>
              ) : null}
            </div>
          </div>
        ))}

        {topicCards && topicCards.length > 0 ? (
          <div className="space-y-1.5 rounded-lg border border-border-muted bg-surface p-2">
            <div className="text-[12px] font-semibold text-text-main">请选择方向</div>
            <p className="-mt-0.5 text-[10px] text-text-tertiary">
              点击下方卡片即可发送对应选题，无需再复制 JSON。
            </p>
            <div className="flex flex-col gap-1.5">
              {topicCards.map((t, idx) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={gatewayError || sending}
                  onClick={() => {
                    onSend(`选方向${idx + 1}：${t.title}`)
                  }}
                  className="text-left w-full rounded-[10px] border border-transparent bg-[#F8F8F8] px-3.5 py-2.5 transition-colors hover:bg-[#f0f0f0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-medium text-text-main">
                      {idx + 1}. {t.title}
                    </span>
                    {t.recommended ? (
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary"
                        title="素材匹配"
                      >
                        推荐
                      </span>
                    ) : null}
                  </div>
                  {t.description ? (
                    <div className="text-[11px] text-text-tertiary mt-1 line-clamp-3 leading-snug">
                      {t.description}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-border-muted px-3 py-2">
        {pendingImage ? (
          <div className="mb-2 flex items-start gap-2 rounded-xl border border-border-muted bg-canvas p-2">
            <img src={pendingImage} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
            <div className="min-w-0 flex-1 text-[11px] text-text-secondary">
              已选图片，将随本机素材库保存并随文字发送给网关（不含图片二进制）。
            </div>
            <button
              type="button"
              onClick={() => setPendingImage(null)}
              className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-canvas"
            >
              移除
            </button>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              try {
                setPendingImage(await fileToCompressedDataUrl(f))
              } catch (err) {
                alert(err instanceof Error ? err.message : '图片处理失败')
              }
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={!!gatewayError || sending}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-muted bg-canvas text-text-secondary transition-colors hover:border-primary/35 hover:text-primary disabled:opacity-50"
            aria-label="添加图片"
            title="添加图片"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"
                fill="currentColor"
              />
            </svg>
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={1}
            placeholder={
              gatewayError
                ? '网关未连接'
                : messages.length === 0
                  ? '可选：需要时在此输入补充说明'
                  : '输入消息…（Enter 发送）'
            }
            disabled={!!gatewayError || sending}
            className="min-h-[36px] max-h-20 flex-1 resize-none rounded-3xl border-[1.5px] border-border-muted bg-canvas px-3 py-2 text-[13px] text-text-main outline-none transition-colors placeholder:text-text-tertiary focus:border-primary disabled:opacity-60"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!!gatewayError || sending || (!input.trim() && !pendingImage)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
            aria-label="发送"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
