/**
 * useIdeashuSync Hook - 适配 IdeaShu 2.0 前端
 * 
 * 用于实时同步飞书 ideashu-v5 对话内容
 * 
 * 用法:
 * ```tsx
 * function Workspace() {
 *   const { isConnected, drafts, latestDraft } = useIdeashuSync({
 *     userId: 'default',
 *   });
 *   
 *   return (
 *     <div>
 *       <ConnectionStatus connected={isConnected} />
 *       <DraftList drafts={drafts} />
 *     </div>
 *   );
 * }
 * ```
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import type { Draft } from '../components/XhsPostEditor'

// ===== Types =====

export interface SyncDraft extends Draft {
  id: string
  user_id?: string
  session_id?: string
  platform?: string
  created_at?: string
  updated_at?: string
}

export interface Topic {
  id: number
  title: string
  source: string
  angle: string
  hook: string
  timing: 'hot' | 'evergreen'
  timingDetail: string
  materialMatch: boolean
  materialCount: number
}

export interface ScoreData {
  hook: number
  authentic: number
  aiSmell: number
  diversity: number
  cta: number
  platform: number
  total: number
  brandMatch: 'match' | 'mismatch'
  suggestions: string[]
  dedup: 'no_duplicate' | string
}

export interface OriginalityData {
  userMaterialPct: number
  aiAssistPct: number
  compliance: 'safe' | 'caution' | 'risk'
  materialSources: string[]
}

export interface UseIdeashuSyncOptions {
  userId?: string
  serverUrl?: string
  wsUrl?: string
  autoConnect?: boolean
  onDraftUpdate?: (draft: SyncDraft) => void
  onTopicsUpdate?: (topics: Topic[]) => void
  onScoreUpdate?: (data: { score: ScoreData; originality: OriginalityData }) => void
  onConnect?: () => void
  onDisconnect?: () => void
  onError?: (error: Error) => void
}

export interface UseIdeashuSyncReturn {
  // 状态
  isConnected: boolean
  isLoading: boolean
  error: Error | null

  // 数据
  drafts: SyncDraft[]
  latestDraft: SyncDraft | null
  topics: Topic[] | null

  // 操作
  connect: () => void
  disconnect: () => void
  refreshDrafts: () => Promise<void>
  getDraft: (id: string) => Promise<SyncDraft | null>
}

// ===== Hook =====

export function useIdeashuSync(options: UseIdeashuSyncOptions = {}): UseIdeashuSyncReturn {
  const {
    userId = 'default',
    serverUrl = '/api',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    wsUrl: _wsUrl,
    autoConnect = true,
    onDraftUpdate,
    onTopicsUpdate,
    onScoreUpdate,
    onConnect,
    onDisconnect,
    onError,
  } = options

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const MAX_RECONNECT_ATTEMPTS = 5

  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [drafts, setDrafts] = useState<SyncDraft[]>([])
  const [latestDraft, setLatestDraft] = useState<SyncDraft | null>(null)
  const [topics, setTopics] = useState<Topic[] | null>(null)

  // 获取草稿列表
  const refreshDrafts = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch(`${serverUrl}/drafts?userId=${userId}`)
      const result = await response.json()
      if (result.success) {
        setDrafts(result.data)
        if (result.data.length > 0) {
          setLatestDraft(result.data[0])
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch drafts'))
      onError?.(err instanceof Error ? err : new Error('Failed to fetch drafts'))
    } finally {
      setIsLoading(false)
    }
  }, [serverUrl, userId, onError])

  // 获取单条草稿
  const getDraft = useCallback(
    async (id: string): Promise<SyncDraft | null> => {
      try {
        const response = await fetch(`${serverUrl}/drafts/${id}`)
        const result = await response.json()
        return result.success ? result.data : null
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error('Failed to fetch draft'))
        return null
      }
    },
    [serverUrl, onError]
  )

  // 连接 WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    // 构建 WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const wsEndpoint = `${protocol}//${host}/api?userId=${userId}`

    console.log('[IdeaShu Sync] Connecting to', wsEndpoint)
    const ws = new WebSocket(wsEndpoint)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[IdeaShu Sync] Connected')
      setIsConnected(true)
      setError(null)
      reconnectAttemptsRef.current = 0
      onConnect?.()

      // 连接后立即获取历史数据
      refreshDrafts()
    }

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        console.log('[IdeaShu Sync] Received:', payload.type)

        switch (payload.type) {
          case 'draft_updated':
            const draft: SyncDraft = payload.data
            setLatestDraft(draft)
            setDrafts((prev) => [draft, ...prev.filter((d) => d.id !== draft.id)])
            onDraftUpdate?.(draft)
            break

          case 'topics_updated':
            const topicsList: Topic[] = payload.data.topics || payload.data
            setTopics(topicsList)
            onTopicsUpdate?.(topicsList)
            break

          case 'score_updated':
            onScoreUpdate?.({
              score: payload.data.score_data,
              originality: payload.data.originality,
            })
            break

          case 'connected':
            console.log('[IdeaShu Sync] Server acknowledged connection')
            break

          case 'pong':
            // 心跳响应
            break
        }
      } catch (err) {
        console.error('[IdeaShu Sync] Failed to parse message:', err)
      }
    }

    ws.onclose = () => {
      console.log('[IdeaShu Sync] Disconnected')
      setIsConnected(false)
      onDisconnect?.()

      // 自动重连
      if (autoConnect && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current++
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000)
        console.log(`[IdeaShu Sync] Reconnecting in ${delay}ms... (attempt ${reconnectAttemptsRef.current})`)
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connect()
        }, delay)
      }
    }

    ws.onerror = (err) => {
      console.error('[IdeaShu Sync] WebSocket error:', err)
      setError(new Error('WebSocket connection failed'))
      onError?.(new Error('WebSocket connection failed'))
    }
  }, [userId, autoConnect, onConnect, onDisconnect, onError, onDraftUpdate, onTopicsUpdate, onScoreUpdate, refreshDrafts])

  // 断开连接
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  // 自动连接
  useEffect(() => {
    if (autoConnect) {
      connect()
    }

    return () => {
      disconnect()
    }
  }, [autoConnect, connect, disconnect])

  return {
    isConnected,
    isLoading,
    error,
    drafts,
    latestDraft,
    topics,
    connect,
    disconnect,
    refreshDrafts,
    getDraft,
  }
}

export default useIdeashuSync
