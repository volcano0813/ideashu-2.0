export type Account = {
  id: string
  name: string
  domain: string
  persona: string
  styleName: string
  learnedRules: number
  trendSources: number
}

export const MOCK_ACCOUNTS: Account[] = [
  {
    id: 'a1',
    name: '每日一杯',
    domain: '咖啡/探店',
    persona: '温柔细节控',
    styleName: '暖光叙事',
    learnedRules: 8,
    trendSources: 3,
  },
  {
    id: 'a2',
    name: '笔记工坊',
    domain: '写作/结构',
    persona: '清晰表达派',
    styleName: '清单结构',
    learnedRules: 5,
    trendSources: 2,
  },
]

export const DEFAULT_ACCOUNT_ID = MOCK_ACCOUNTS[0]?.id ?? ''

export function getAccountById(id: string): Account | undefined {
  return MOCK_ACCOUNTS.find((a) => a.id === id)
}
