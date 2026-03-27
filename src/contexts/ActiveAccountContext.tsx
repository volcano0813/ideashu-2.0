import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { createNewAccount, stripAccountNameAsterisks, type Account } from '../lib/accounts'
import { loadAccounts, saveAccounts } from '../lib/ideashuStorage'

export const ACTIVE_ACCOUNT_KEY = 'ideashu.activeAccountId.v1'

export type AccountProfileInput = {
  name: string
  domain?: string
  persona?: string
  /** 调性描述（温暖但不油腻...这种人话风格） */
  tone?: string
  /** 口头禅/常用句 */
  catchPhrases?: string[]
  styleName?: string
}

function sanitizeAccountName(raw: string): string {
  return stripAccountNameAsterisks((raw ?? '').trim())
}

type ActiveAccountContextValue = {
  accounts: Account[]
  activeAccount: Account
  activeAccountId: string
  setActiveAccountId: (id: string) => void
  addAccount: (name: string) => void
  /** 按账号名 upsert：不存在则新建；存在则合并字段并持久化 */
  upsertAccountProfile: (input: AccountProfileInput) => void
  deleteAccount: (id: string) => void
  /** 合并写入当前账号（持久化） */
  patchActiveAccount: (patch: Partial<Account>) => void
  /** 将当前账号的累计编辑次数增加 delta（仅 delta>0） */
  addCumulativeEditsToActiveAccount: (delta: number) => void
}

const ActiveAccountContext = createContext<ActiveAccountContextValue | null>(null)

function readStoredId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_ACCOUNT_KEY)
  } catch {
    return null
  }
}

function pickInitialActiveId(list: Account[]): string {
  const raw = readStoredId()
  if (raw && list.some((a) => a.id === raw)) return raw
  return list[0]?.id ?? ''
}

export function ActiveAccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>(() => loadAccounts())
  const [activeAccountId, setActiveAccountIdState] = useState(() =>
    pickInitialActiveId(loadAccounts()),
  )

  const setActiveAccountId = useCallback(
    (id: string) => {
      if (!accounts.some((a) => a.id === id)) return
      setActiveAccountIdState(id)
      try {
        localStorage.setItem(ACTIVE_ACCOUNT_KEY, id)
      } catch {
        // ignore
      }
    },
    [accounts],
  )

  const addAccount = useCallback((name: string) => {
    const safeName = sanitizeAccountName(name)
    const acc = createNewAccount(safeName)
    setAccounts((prev) => {
      const next = [...prev, acc]
      saveAccounts(next)
      return next
    })
    setActiveAccountIdState(acc.id)
    try {
      localStorage.setItem(ACTIVE_ACCOUNT_KEY, acc.id)
    } catch {
      // ignore
    }
  }, [])

  const upsertAccountProfile = useCallback((input: AccountProfileInput) => {
    const name = sanitizeAccountName(input.name)
    if (!name) return

    const clean = <T extends string | undefined>(v: T) => (typeof v === 'string' ? v.trim() : v)
    const domain = clean(input.domain)
    const persona = clean(input.persona)
    const tone = clean(input.tone)
    const styleName = clean(input.styleName)
    const catchPhrases =
      Array.isArray(input.catchPhrases) && input.catchPhrases.length
        ? input.catchPhrases.map((s) => s.trim()).filter(Boolean)
        : undefined

    setAccounts((prev) => {
      const idx = prev.findIndex((a) => sanitizeAccountName(a.name) === name)
      const next = [...prev]
      const base = idx >= 0 ? next[idx]! : createNewAccount(name)
      const merged: Account = {
        ...base,
        // Only override when meaningful values are provided.
        domain: domain && domain.length ? domain : base.domain,
        persona: persona && persona.length ? persona : base.persona,
        tone: tone && tone.length ? tone : base.tone,
        catchPhrases: catchPhrases && catchPhrases.length ? catchPhrases : base.catchPhrases,
        styleName:
          (styleName && styleName.length ? styleName : null) ??
          (tone && tone.length ? tone : null) ??
          base.styleName,
      }
      if (idx >= 0) next[idx] = merged
      else next.push(merged)
      saveAccounts(next)
      return next
    })
  }, [])

  const patchActiveAccount = useCallback((patch: Partial<Account>) => {
    setAccounts((prev) => {
      const idx = prev.findIndex((a) => a.id === activeAccountId)
      if (idx < 0) return prev
      const next = [...prev]
      const merged =
        patch.name !== undefined
          ? { ...patch, name: stripAccountNameAsterisks(patch.name) }
          : patch
      next[idx] = { ...next[idx]!, ...merged }
      saveAccounts(next)
      return next
    })
  }, [activeAccountId])

  const addCumulativeEditsToActiveAccount = useCallback(
    (delta: number) => {
      if (delta <= 0) return
      setAccounts((prev) => {
        const idx = prev.findIndex((a) => a.id === activeAccountId)
        if (idx < 0) return prev
        const next = [...prev]
        const cur = next[idx]!
        next[idx] = {
          ...cur,
          cumulativeEditCount: (cur.cumulativeEditCount ?? 0) + delta,
        }
        saveAccounts(next)
        return next
      })
    },
    [activeAccountId],
  )

  const deleteAccount = useCallback((id: string) => {
    let nextAfterDelete: Account[] | null = null
    setAccounts((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.filter((a) => a.id !== id)
      if (next.length === prev.length) return prev
      saveAccounts(next)
      nextAfterDelete = next
      return next
    })
    setActiveAccountIdState((cur) => {
      if (cur !== id || !nextAfterDelete?.length) return cur
      const first = nextAfterDelete[0]!.id
      try {
        localStorage.setItem(ACTIVE_ACCOUNT_KEY, first)
      } catch {
        // ignore
      }
      return first
    })
  }, [])

  const activeAccount = useMemo(() => {
    return accounts.find((a) => a.id === activeAccountId) ?? accounts[0]!
  }, [activeAccountId, accounts])

  const value = useMemo(
    () => ({
      accounts,
      activeAccount,
      activeAccountId,
      setActiveAccountId,
      addAccount,
      upsertAccountProfile,
      deleteAccount,
      patchActiveAccount,
      addCumulativeEditsToActiveAccount,
    }),
    [
      accounts,
      activeAccount,
      activeAccountId,
      setActiveAccountId,
      addAccount,
      upsertAccountProfile,
      deleteAccount,
      patchActiveAccount,
      addCumulativeEditsToActiveAccount,
    ],
  )

  return <ActiveAccountContext.Provider value={value}>{children}</ActiveAccountContext.Provider>
}

export function useActiveAccount(): ActiveAccountContextValue {
  const ctx = useContext(ActiveAccountContext)
  if (!ctx) {
    throw new Error('useActiveAccount must be used within ActiveAccountProvider')
  }
  return ctx
}
