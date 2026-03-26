import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_ACCOUNT_ID,
  getAccountById,
  MOCK_ACCOUNTS,
  type Account,
} from '../lib/accounts'

export const ACTIVE_ACCOUNT_KEY = 'ideashu.activeAccountId.v1'

type ActiveAccountContextValue = {
  activeAccount: Account
  activeAccountId: string
  setActiveAccountId: (id: string) => void
}

const ActiveAccountContext = createContext<ActiveAccountContextValue | null>(null)

function readStoredId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_ACCOUNT_KEY)
  } catch {
    return null
  }
}

export function ActiveAccountProvider({ children }: { children: ReactNode }) {
  const [activeAccountId, setActiveAccountIdState] = useState(() => {
    const raw = readStoredId()
    if (raw && getAccountById(raw)) return raw
    return DEFAULT_ACCOUNT_ID
  })

  const setActiveAccountId = useCallback((id: string) => {
    if (!getAccountById(id)) return
    setActiveAccountIdState(id)
    try {
      localStorage.setItem(ACTIVE_ACCOUNT_KEY, id)
    } catch {
      // ignore quota / private mode
    }
  }, [])

  const activeAccount = useMemo(() => {
    return getAccountById(activeAccountId) ?? MOCK_ACCOUNTS[0]!
  }, [activeAccountId])

  const value = useMemo(
    () => ({ activeAccount, activeAccountId, setActiveAccountId }),
    [activeAccount, activeAccountId, setActiveAccountId],
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
