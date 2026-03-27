import { createOpenClawClient } from './openclawClient'

export const openclaw = createOpenClawClient({
  url: 'ws://127.0.0.1:18789/',
  connectTimeoutMs: 30000,
})

const CONNECT_KEY = '__ideashu_openclaw_connectPromise'

/**
 * Deduplicate concurrent connect() calls (workspace + hotspot + retries share one in-flight promise).
 */
export function ensureOpenClawConnected(): Promise<void> {
  const g = globalThis as unknown as Record<string, Promise<void> | undefined>
  const existing = g[CONNECT_KEY]
  if (existing) return existing

  const p = openclaw.connect().finally(() => {
    delete g[CONNECT_KEY]
  })
  g[CONNECT_KEY] = p
  return p
}

/** Call before reconnect so the next ensureOpenClawConnected() is not swallowed by a stale promise. */
export function invalidateOpenClawConnectPromise(): void {
  const g = globalThis as unknown as Record<string, Promise<void> | undefined>
  delete g[CONNECT_KEY]
}
