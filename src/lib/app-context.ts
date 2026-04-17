import type { Filters, Lang, Theme, SessionMeta, AppData, StatsCache } from './types'
import type { useDerivedStats } from '../hooks/useData'

type DerivedStats = NonNullable<ReturnType<typeof useDerivedStats>>

export interface InfoItem {
  label: string
  source: string
  formula: string
  note?: string
}

export interface AppContext {
  // data
  data: AppData
  derived: DerivedStats
  statsCache: StatsCache

  // filters
  filters: Filters
  setFilters: React.Dispatch<React.SetStateAction<Filters>>

  // preferences
  lang: Lang
  theme: Theme
  currency: 'USD' | 'BRL'
  setCurrency: React.Dispatch<React.SetStateAction<'USD' | 'BRL'>>
  brlRate: number

  // budget
  monthlyBudgetUSD: number | null
  updateBudget: (v: number | null) => void

  // derived totals
  totalInputTokens: number
  totalOutputTokens: number

  // modal setters
  setExpandedChart: (id: string | null) => void
  setSelectedSession: (s: SessionMeta | null) => void
  setInfoModalIndex: (i: number | null) => void

  // info items for KPI cards
  infoItems: InfoItem[]

  // drag state for KPI cards
  cardOrder: string[]
  setCardOrder: React.Dispatch<React.SetStateAction<string[]>>
  dragCardRef: React.MutableRefObject<string | null>
  dragOverCard: string | null
  setDragOverCard: (v: string | null) => void
}
