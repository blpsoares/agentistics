import type { Filters, Lang, Theme, SessionMeta, AppData, StatsCache, HarnessId } from '@agentistics/core'
import type { useDerivedStats } from '../hooks/useData'
import type { ChatModelId } from './chatModels'

type DerivedStats = NonNullable<ReturnType<typeof useDerivedStats>>

export interface InfoItem {
  label: string
  source: string
  formula: string
  note?: string
}

/** The `beforeinstallprompt` event, captured in App and threaded to the Install settings page. */
export type PwaPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

/** The logged-in IAM account (role + team memberships), threaded from App.tsx `iam.account`.
 *  Structurally matches `IamAccount` in App.tsx; kept inline here to avoid importing App into a lib. */
export interface Principal {
  id: string
  name: string
  email: string
  role: 'owner' | 'member'
  memberships: { teamId: string; role: 'manager' | 'user' }[]
}

/** Draft shape for the Preferences settings page / modal (single source of truth). */
export interface PrefsDraft {
  lang: Lang
  theme: Theme
  currency: 'USD' | 'BRL'
  cardOrder: string[]
  cardPrecision: Record<string, boolean>
  chatModel: ChatModelId | null
  chatSoundEnabled: boolean
  chatSoundId: string
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
  setCurrency: (c: 'USD' | 'BRL') => void
  brlRate: number

  // chat preferences (seed the Preferences settings page draft)
  chatModel: ChatModelId | null
  chatSoundEnabled: boolean
  chatSoundId: string

  /** Persists a full preferences draft: applies it to global state + PUTs /api/preferences.
   *  Reuses the same logic the old Settings modal ran on Save. */
  savePreferences: (draft: PrefsDraft) => void

  // PWA install (captured in App from the beforeinstallprompt event)
  pwaPrompt: PwaPrompt | null
  onPwaInstalled: () => void

  // live-update settings (applied immediately — threaded to the Live settings page)
  liveUpdates: boolean
  setLiveUpdates: (v: boolean) => void
  updateInterval: number
  setUpdateInterval: (v: number) => void
  riskyMode: boolean
  setRiskyMode: (v: boolean) => void
  highlightUpdates: boolean
  setHighlightUpdates: (v: boolean) => void

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

  // card order for home page (managed via preferences)
  cardOrder: string[]
  setCardOrder: React.Dispatch<React.SetStateAction<string[]>>

  // per-card full precision toggle
  cardPrecision: Record<string, boolean>
  setCardPrecision: (id: string, v: boolean) => void

  // filter bar data (needed to render FiltersBar outside the header, e.g. in CustomPage)
  sessionCountByProject: Record<string, number>
  models: string[]
  modelGroups: { harness: HarnessId; models: string[] }[]
  modelsInProject: Set<string> | null
  /** Distinct users present in the data (team mode). Empty in Solo mode. */
  users: string[]
  /** Harnesses present in the data. Empty in Solo mode (Claude-only). */
  harnesses: HarnessId[]
  /** True when this instance is running as a team-mode central (aggregator). */
  isCentral: boolean
  /** The logged-in IAM account (role + memberships). Undefined when IAM is not active. */
  me?: Principal
}
