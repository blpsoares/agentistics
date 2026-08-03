/**
 * i18n.ts — English/Portuguese strings for the terminal dashboard.
 *
 * Same reasoning as `cli-i18n.ts` in the server package: the @agentistics/core i18n keys are
 * web-focused and that module is compiled into the BROWSER bundle, so terminal-only strings
 * placed there would be downloaded by every dashboard user for no benefit. Language resolution
 * itself is shared (`--lang` / `preferences.lang`) — the caller passes the resolved language in.
 */

export type TuiLang = 'en' | 'pt'

export interface TuiStrings {
  // chrome
  tagline: string
  live: string
  offline: string
  connecting: string
  loading: string

  // screens
  overview: string
  projects: string
  sessions: string
  costs: string
  harnesses: string

  // KPIs / columns
  cost: string
  tokens: string
  sessionsCount: string
  messages: string
  streak: string
  project: string
  model: string
  harness: string
  lastActivity: string
  activity30d: string
  share: string
  started: string
  agents: string

  // states
  empty: string
  noProjects: string
  noSessions: string
  tooNarrow: string
  apiStarting: string
  apiFailed: string
  needsTty: string

  // footer / help
  quit: string
  help: string
  filter: string
  nav: string
  helpTitle: string
  helpNav: string
  helpFilter: string
  helpQuit: string
  helpClose: string
  filterTitle: string
  filterAll: string
  filterHint: string

  days: (n: number) => string
}

const en: TuiStrings = {
  tagline: 'live coding-assistant analytics',
  live: 'live',
  offline: 'offline',
  connecting: 'connecting',
  loading: 'Loading data',

  overview: 'Overview',
  projects: 'Projects',
  sessions: 'Sessions',
  costs: 'Costs',
  harnesses: 'Harnesses',

  cost: 'cost',
  tokens: 'tokens',
  sessionsCount: 'sessions',
  messages: 'messages',
  streak: 'streak',
  project: 'project',
  model: 'model',
  harness: 'harness',
  lastActivity: 'last activity',
  activity30d: 'activity · last 30 days',
  share: 'share',
  started: 'started',
  agents: 'agents',

  empty: 'Nothing to show yet',
  noProjects: 'No projects recorded yet',
  noSessions: 'No sessions recorded yet',
  tooNarrow: 'Terminal too narrow — widen to at least 60 columns',
  apiStarting: 'Starting the agentistics server',
  apiFailed: 'Could not reach the agentistics server',
  needsTty: 'agentop tui needs an interactive terminal (its input is not a TTY).',

  quit: 'quit',
  help: 'help',
  filter: 'filter',
  nav: 'switch screen',
  helpTitle: 'Keyboard',
  helpNav: '1-5 / tab   switch screen',
  helpFilter: 'f           filter by harness',
  helpQuit: 'q / ctrl+c  quit',
  helpClose: 'esc         close this panel',
  filterTitle: 'Filter by harness',
  filterAll: 'All harnesses',
  filterHint: '↑↓ choose · enter apply · esc cancel',

  days: n => `${n}d`,
}

const pt: TuiStrings = {
  tagline: 'analytics ao vivo dos assistentes de código',
  live: 'ao vivo',
  offline: 'offline',
  connecting: 'conectando',
  loading: 'Carregando dados',

  overview: 'Visão geral',
  projects: 'Projetos',
  sessions: 'Sessões',
  costs: 'Custos',
  harnesses: 'Assistentes',

  cost: 'custo',
  tokens: 'tokens',
  sessionsCount: 'sessões',
  messages: 'mensagens',
  streak: 'sequência',
  project: 'projeto',
  model: 'modelo',
  harness: 'assistente',
  lastActivity: 'última atividade',
  activity30d: 'atividade · últimos 30 dias',
  share: 'participação',
  started: 'início',
  agents: 'agentes',

  empty: 'Nada para mostrar ainda',
  noProjects: 'Nenhum projeto registrado ainda',
  noSessions: 'Nenhuma sessão registrada ainda',
  tooNarrow: 'Terminal muito estreito — aumente para ao menos 60 colunas',
  apiStarting: 'Iniciando o servidor agentistics',
  apiFailed: 'Não foi possível acessar o servidor agentistics',
  needsTty: 'agentop tui precisa de um terminal interativo (a entrada não é um TTY).',

  quit: 'sair',
  help: 'ajuda',
  filter: 'filtrar',
  nav: 'trocar de tela',
  helpTitle: 'Teclado',
  helpNav: '1-5 / tab   trocar de tela',
  helpFilter: 'f           filtrar por assistente',
  helpQuit: 'q / ctrl+c  sair',
  helpClose: 'esc         fechar este painel',
  filterTitle: 'Filtrar por assistente',
  filterAll: 'Todos os assistentes',
  filterHint: '↑↓ escolher · enter aplicar · esc cancelar',

  days: n => `${n}d`,
}

export const TUI_STRINGS: Record<TuiLang, TuiStrings> = { en, pt }

export function strings(lang: TuiLang): TuiStrings {
  return TUI_STRINGS[lang] ?? en
}
