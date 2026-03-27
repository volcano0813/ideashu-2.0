export type HotTopicType = '热点' | '趋势' | '常青'

export type HotTrend = 'exploding' | 'rising' | 'stable' | 'declining'

export type HotTopic = {
  id: string
  title: string
  type: HotTopicType
  category: string
  source: {
    type: string
    primarySource: {
      platform: string
      title: string
      url?: string
      domain?: string
      /** ISO date when the source article was published (if known) */
      publishedAt?: string
    }
    relatedSources: Array<{
      platform: string
      icon: string
      title: string
      url: string
    }>
  }
  heat: {
    score: number
    trend: HotTrend
    interactionCount?: number
    recencyHours?: number
  }
  tags: {
    cutIn: string
    hook: string
    window: string
  }
  materialMatch: boolean
  materialCount: number
  date: string
  matchScore?: number
}

