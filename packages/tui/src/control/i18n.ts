/**
 * i18n.ts — the control center's own chrome strings (EN/PT).
 *
 * Division of labour with `server/cli-i18n.ts`: anything the HOST produces — service labels,
 * mode sentences, action outcomes — is already localized by the time it reaches a component, and
 * stays in `cli-i18n.ts`. What lives here is the chrome the TUI owns and the server knows nothing
 * about: tab names, key hints, empty states, the words on this app's own screens.
 */

import type { CliLang } from './lang'
import type { TabId } from './types'

export interface ControlStrings {
  tagline: string

  tabs: Record<TabId, string>
  /**
   * The tab bar's names — lowercase, because the bar is chrome and the panes are what the eye
   * should land on, and short because six of them share one row in two languages.
   *
   * They are also every pane title on the linear screens, so a screen is called the same thing in
   * the bar and in the frame around it.
   */
  tabsShort: Record<TabId, string>

  /** Footer key hints. */
  keyTabs: string
  keyPane: string
  keyMove: string
  keySelect: string
  keyActions: string
  keyActionMove: string
  keyRun: string
  keyStop: string
  keyRestart: string
  keyOpen: string
  keyBack: string
  keyQuit: string
  /**
   * The way out of the output pane a running task owns.
   *
   * `dismiss` rather than `back`: the pane is not a place you navigated into, it is a thing that
   * appeared over the facts, and esc puts the facts back.
   */
  keyTaskClose: string
  keyScroll: string
  /** `g`/`G` and Home/End — the ends of a document, named once for every screen that scrolls. */
  keyEnds: string
  keyRefresh: string
  keyLogSource: string
  /**
   * The mouse's two hints, said only while there IS a mouse.
   *
   * `keyMouseCopy` is the important one and exists because tracking has a cost: with the terminal
   * reporting buttons, a plain drag no longer selects text, and `shift` is what hands the gesture
   * back to the terminal. It is stated only while tracking is on, because that is the only time it
   * is true — a hint for a workaround that is not needed teaches the wrong thing just as surely as
   * a hint for a key that does nothing.
   */
  keyMouse: string
  keyMouseCopy: string

  /** Pane titles. */
  paneServices: string
  paneConfig: string
  /** The detail pane's title while nothing is selected; normally it wears the service's name. */
  paneDetail: string
  /**
   * The output pane's title when the action that opened it was not named.
   *
   * Normally it wears the VERB the user pressed — "Rebuild & restart", "Start (docker)" — because
   * that is what makes a wall of build output attributable. This is the fallback, so output can
   * never arrive with nowhere to go.
   */
  paneOutput: string

  /**
   * The detail pane's section rules.
   *
   * Uppercase, like every other section header in the app (small caps, which no terminal has), and
   * plural because each heads a list of rows rather than one fact.
   */
  sectionRuntimes: string
  sectionAddresses: string
  sectionMachine: string

  modeLabel: string
  historyLabel: string
  endpointLabel: string
  languageLabel: string
  /** The language currently in force, named in itself — `English` in EN, `Português` in PT. */
  languageValue: string
  setupLabel: string
  /** The config pane's mouse row, and the two words it states. `on`/`off`, never a colour. */
  mouseLabel: string
  mouseOn: string
  mouseOff: string

  /** Detail pane. */
  pidLabel: string
  uptimeLabel: string
  webLabel: string
  apiLabel: string
  noServices: string
  /**
   * The boot row: whether the service comes back after a reboot.
   *
   * There is no third word for "we could not tell" on purpose — an unknown draws NO row, because a
   * service that says "will not restart" when nobody asked systemd is a fact a user acts on.
   */
  bootLabel: string
  bootOn: string
  bootOff: string

  /**
   * Actions on the focused service.
   *
   * There is no generic `Start` here any more, and no generic `Restart` either: both are per
   * RUNTIME, and only the host knows which ones this box can perform — so it composes and labels
   * them (`Start (docker)`, `Rebuild & restart`), and this table carries only the verbs whose
   * meaning is the same wherever they appear. `Restart all` survives because "all" is the one
   * target the selection cannot name.
   */
  actStop: string
  actOpen: string
  actStopAll: string
  actRestartAll: string
  /** Names the version, so the verb states what it is about to install. */
  actUpgrade: (version: string) => string
  actConnect: string
  actDisconnect: string
  actHistory: string
  actLanguage: string
  actMouse: string
  /** Install the boot unit for the selected service — offered beside its start options. */
  actBoot: string

  stateUp: string
  stateDown: string
  stateUnknown: string
  /**
   * The services row's word for `ControlService.conflict`.
   *
   * The row has one cell for a state, and the host's conflict sentence is a sentence; this is what
   * fits in the cell. It is a WORD beside the danger colour and a glyph, never the colour alone,
   * and the sentence itself is right there in the detail pane.
   */
  stateConflict: string

  working: string
  yes: string
  no: string

  /** Services tab. */
  killQuestion: string

  /** Setup tab. */
  setupIntro: string
  setupSolo: string
  setupSoloHint: string
  setupCentral: string
  setupCentralHint: string
  setupMember: string
  setupMemberHint: string
  archiveUnset: string
  archiveQuestion: string
  archiveWhy: string
  archiveConsolidate: string
  archiveConsolidateHint: string
  archiveFull: string
  archiveFullHint: string
  archiveOff: string
  archiveOffHint: string
  /** The opening gate's fourth option, and what it costs. Absent from the other callers' menus. */
  archiveLater: string
  archiveLaterHint: string
  archiveLaterMessage: string
  bootQuestion: string

  /** Logs tab. */
  logSource: string
  logEmpty: string
  logLoading: string
  logFollow: string
  logFollowing: string
  logPaused: string

  /** Sessions tab. */
  sessionsEmpty: string
  sessionsLoading: string
  /** Said when the host does not implement the fleet at all — not the same as an empty fleet. */
  sessionsUnsupported: string
  /** The summary row: "3 sessions · 1 waiting on you". */
  sessionsCount: (n: number) => string
  sessionsWaitingCount: (n: number) => string
  sessionsGroupBy: string
  sessionsGroupings: Record<'none' | 'harness' | 'model' | 'project' | 'task', string>
  sessionsUnknownHarness: string
  sessionsUnknownModel: string
  sessionsUnknownProject: string
  sessionsUnknownTask: string
  /** Detail-pane field labels. */
  sessionsWhere: string
  sessionsModel: string
  sessionsNote: string
  sessionsStarted: string
  sessionsDoing: string
  sessionsTask: string
  sessionsMetrics: string
  /** How long ago, from a whole number of SECONDS — the caller does the clock arithmetic so this
   *  stays a pure formatter. */
  sessionsAgo: (seconds: number) => string
  /** The external row's own sentence, in the detail pane. */
  sessionsExternalNote: string
  sessionsClosedNote: string
  keySessionsGroup: string
  keySessionsAttach: string
  keySessionsKill: string
  keySessionsRename: string
  keySessionsNote: string
  keySessionsNew: string
  keySessionsSearch: string
  keySessionsActions: string
  /** The visible action row — the same verbs the letters run, spelled out and clickable. */
  actSessions: {
    attach: string
    resume: string
    rename: string
    note: string
    task: string
    kill: string
    openTask: string
    newSession: string
    search: string
    group: string
  }
  sessionsTaskPrompt: string
  sessionsOpenTaskConfirm: (task: string, n: number) => string
  sessionsResumeConfirm: (title: string) => string
  sessionsResumeRunning: string
  sessionsSearchLabel: string
  sessionsSearchEmpty: string
  sessionsClosedWord: string
  sessionsShowClosed: string
  sessionsHideClosed: string
  keySessionsClosed: string
  keySessionsNoTask: string
  sessionsNoTaskHidden: string
  sessionsNoTaskShown: string
  /** The wizard's six questions. */
  wizHarness: string
  wizWhere: string
  wizWhereHint: string
  wizModel: string
  wizModelHint: string
  wizEffort: string
  wizPrompt: string
  wizPromptHint: string
  wizHow: string
  wizAttached: string
  wizBackground: string
  wizSkip: string
  wizNoMatch: string
  wizSourceCwd: string
  wizSourceTyped: string
  wizSourceHistory: string
  wizSourceRepo: string
  /** The rename / note prompts, and the kill confirmation. */
  sessionsRenamePrompt: string
  sessionsNotePrompt: string
  sessionsKillConfirm: (title: string) => string
  /** Said when a verb is pressed on a row that cannot take it. */
  sessionsNotActionable: string

  /** Static tabs. */
  helpIntro: string
  cheatIntro: string
  contributeIntro: string
  copyHint: string
  /** The same reminder while the mouse reports, when a plain drag no longer selects. */
  copyHintShift: string
}

const EN: ControlStrings = {
  tagline: 'AI coding-assistant analytics',

  tabs: {
    services: 'Services',
    sessions: 'Sessions',
    setup: 'Setup',
    logs: 'Logs',
    cheatsheet: 'Cheat sheet',
    help: 'Help',
    contribute: 'Contribute',
  },

  tabsShort: {
    services: 'services',
    sessions: 'sessions',
    setup: 'setup',
    logs: 'logs',
    cheatsheet: 'commands',
    help: 'help',
    contribute: 'contribute',
  },

  keyTabs: '←→ screens',
  keyPane: 'tab pane',
  keyMove: '↑↓ move',
  keySelect: 'enter select',
  keyActions: 'enter actions',
  keyActionMove: '←→ action',
  keyRun: 'enter run',
  keyStop: 's stop',
  keyRestart: 'R restart',
  keyOpen: 'o open',
  keyBack: 'esc back',
  keyQuit: 'q quit',
  keyTaskClose: 'esc dismiss',
  keyScroll: '↑↓/pg scroll',
  keyEnds: 'g/G ends',
  keyRefresh: 'r refresh',
  keyLogSource: '[ ] source',
  keyMouse: 'm mouse',
  keyMouseCopy: 'shift+drag to copy',

  paneServices: 'services',
  paneConfig: 'config',
  paneDetail: 'detail',
  paneOutput: 'output',

  sectionRuntimes: 'RUNTIMES',
  sectionAddresses: 'ADDRESSES',
  sectionMachine: 'MACHINE',

  // Lowercase, and the same case as the pane titles: these are row labels inside a pane, not
  // section headers over one. SETUP stays uppercase because it still heads a section.
  modeLabel: 'mode',
  historyLabel: 'history',
  endpointLabel: 'endpoint',
  languageLabel: 'language',
  languageValue: 'English',
  setupLabel: 'SETUP',
  mouseLabel: 'mouse',
  mouseOn: 'on',
  mouseOff: 'off',

  pidLabel: 'pid',
  uptimeLabel: 'up',
  webLabel: 'web',
  apiLabel: 'api',
  noServices: 'nothing detected yet.',
  bootLabel: 'boot',
  bootOn: 'starts at boot',
  bootOff: 'does not start at boot',

  actStop: 'Stop',
  actOpen: 'Open in browser',
  actStopAll: 'Stop all',
  actRestartAll: 'Restart all',
  actUpgrade: (v) => `Upgrade to v${v} & restart`,
  actConnect: 'Connect',
  actDisconnect: 'Disconnect',
  actHistory: 'Change',
  actLanguage: 'Switch',
  actMouse: 'Switch',
  actBoot: 'Start at boot',

  stateUp: 'up',
  stateDown: 'stopped',
  stateUnknown: 'unknown',
  stateConflict: 'conflict',

  working: 'working',
  yes: 'Yes',
  no: 'No',

  killQuestion: 'A server is already running here — stop it and start a new one?',

  setupIntro: 'How this machine tracks usage, and what leaves it.',
  setupSolo: 'solo',
  setupSoloHint: 'local only — nothing leaves this machine',
  setupCentral: 'central',
  setupCentralHint: 'host the team central (Docker) here',
  setupMember: 'member',
  setupMemberHint: 'everything solo does, plus push metrics (never chat) to a central',
  archiveUnset: 'not chosen yet',
  archiveQuestion: 'Preserve session history?',
  archiveWhy: 'Claude deletes session transcripts older than 30 days.',
  archiveConsolidate: 'consolidate',
  archiveConsolidateHint: 'recommended — store computed per-session metrics (~KB each)',
  archiveFull: 'full',
  archiveFullHint: 'archivist — also mirror raw transcripts so you can re-read chats (heavy)',
  archiveOff: 'off',
  archiveOffHint: "do nothing — use Claude's default 30-day cleanup",
  archiveLater: 'decide later',
  archiveLaterHint: 'the dashboard will require an answer before it opens',
  archiveLaterMessage: 'History left unset — the dashboard will ask before it opens.',
  bootQuestion: 'Start it on every boot (systemd user service)?',

  logSource: 'SOURCE',
  logEmpty: 'nothing logged yet.',
  logLoading: 'reading…',
  logFollow: 'f follow',
  logFollowing: 'following',
  logPaused: 'paused',

  sessionsEmpty: 'no sessions running.',
  sessionsLoading: 'reading…',
  sessionsUnsupported: 'session management is not available on this machine.',
  sessionsCount: (n: number) => (n === 1 ? '1 session' : `${n} sessions`),
  sessionsWaitingCount: (n: number) => (n === 1 ? '1 waiting on you' : `${n} waiting on you`),
  sessionsGroupBy: 'GROUP',
  sessionsGroupings: {
    task: 'task',
    none: 'flat',
    harness: 'harness',
    model: 'model',
    project: 'project',
  },
  sessionsUnknownHarness: 'harness unknown',
  sessionsUnknownModel: 'no model recorded',
  sessionsUnknownProject: 'no directory recorded',
  sessionsUnknownTask: 'no task',
  sessionsWhere: 'where',
  sessionsModel: 'model',
  sessionsNote: 'note',
  sessionsStarted: 'started',
  sessionsDoing: 'saying',
  sessionsTask: 'task',
  sessionsMetrics: 'usage',
  sessionsAgo: (sec: number) => {
    if (sec < 60) return `${sec}s ago`
    const min = Math.round(sec / 60)
    if (min < 60) return `${min}m ago`
    return `${Math.floor(min / 60)}h ${min % 60}m ago`
  },
  sessionsExternalNote: 'started outside agentop — listed, but it cannot be attached or stopped here.',
  sessionsClosedNote: 'not running — reopen it to pick this conversation back up.',
  keySessionsGroup: 'v group',
  keySessionsAttach: '⏎ attach',
  keySessionsKill: 'x kill',
  keySessionsRename: 'n name',
  keySessionsNote: 't note',
  keySessionsNew: 'a new',
  keySessionsSearch: '/ search',
  keySessionsActions: 'tab actions',
  actSessions: {
    attach: 'Attach',
    resume: 'Reopen',
    rename: 'Rename',
    note: 'Note',
    task: 'Task',
    kill: 'Stop',
    openTask: 'Open whole task',
    newSession: 'New session',
    search: 'Search',
    group: 'Group',
  },
  sessionsTaskPrompt: 'Which task does this session belong to?',
  sessionsOpenTaskConfirm: (task: string, n: number) =>
    `Reopen all ${n} session(s) of "${task}" in the background?`,
  sessionsResumeConfirm: (title: string) => `Reopen "${title}" as a session agentop manages?`,
  sessionsResumeRunning:
    'the assistant already running there is NOT stopped — close it first, or you will have two on one conversation.',
  sessionsSearchLabel: 'Search sessions and closed conversations',
  sessionsSearchEmpty: 'nothing matches.',
  sessionsClosedWord: 'closed',
  sessionsShowClosed: 'closed: shown',
  sessionsHideClosed: 'closed: hidden',
  keySessionsClosed: 'c closed',
  keySessionsNoTask: 'u unfiled',
  sessionsNoTaskHidden: 'unfiled: hidden',
  sessionsNoTaskShown: 'unfiled: shown',
  wizHarness: 'Which assistant?',
  wizWhere: 'Where should it start?',
  wizWhereHint: 'search any folder under your home — or paste a full path',
  wizModel: 'Which model?',
  wizModelHint: 'pick one, or type any model name',
  wizEffort: 'Which reasoning effort?',
  wizPrompt: 'First prompt (optional)',
  wizPromptHint: 'leave empty to start with nothing typed',
  wizHow: 'Start it how?',
  wizAttached: 'attached — take this terminal now',
  wizBackground: 'background — keep it running and stay here',
  wizSkip: 'use the default',
  wizNoMatch: 'nothing matches — paste a full path to use a directory anywhere on this machine',
  wizSourceCwd: 'you are here',
  wizSourceTyped: 'typed',
  wizSourceHistory: 'worked here before',
  wizSourceRepo: 'git repo',
  sessionsRenamePrompt: 'Name this session',
  sessionsNotePrompt: 'Describe this session',
  sessionsKillConfirm: (title: string) => `Stop "${title}"? The assistant running in it is ended.`,
  sessionsNotActionable: 'that session was not started by agentop, so it cannot be driven from here.',

  helpIntro: 'Every command, with the flags that matter. `agentop --help` prints this plain.',
  cheatIntro: 'The commands worth remembering.',
  contributeIntro: 'Agentistics is open source — issues and pull requests welcome.',
  copyHint: 'select with the mouse to copy',
  copyHintShift: 'hold shift and drag to select and copy',
}

const PT: ControlStrings = {
  tagline: 'Analytics de assistentes de código IA',

  tabs: {
    services: 'Serviços',
    sessions: 'Sessões',
    setup: 'Setup',
    logs: 'Logs',
    cheatsheet: 'Comandos',
    help: 'Ajuda',
    contribute: 'Contribuir',
  },

  tabsShort: {
    services: 'serviços',
    sessions: 'sessões',
    setup: 'setup',
    logs: 'logs',
    cheatsheet: 'comandos',
    help: 'ajuda',
    contribute: 'contribuir',
  },

  keyTabs: '←→ telas',
  keyPane: 'tab painel',
  keyMove: '↑↓ mover',
  keySelect: 'enter escolher',
  keyActions: 'enter ações',
  keyActionMove: '←→ ação',
  keyRun: 'enter executar',
  keyStop: 's parar',
  keyRestart: 'R reiniciar',
  keyOpen: 'o abrir',
  keyBack: 'esc voltar',
  keyQuit: 'q sair',
  keyTaskClose: 'esc fechar',
  keyScroll: '↑↓/pg rolar',
  keyEnds: 'g/G extremos',
  keyRefresh: 'r atualizar',
  keyLogSource: '[ ] fonte',
  keyMouse: 'm mouse',
  keyMouseCopy: 'shift+arrastar copia',

  paneServices: 'serviços',
  paneConfig: 'config',
  paneDetail: 'detalhe',
  paneOutput: 'saída',

  sectionRuntimes: 'RUNTIMES',
  sectionAddresses: 'ENDEREÇOS',
  sectionMachine: 'MÁQUINA',

  modeLabel: 'modo',
  historyLabel: 'histórico',
  endpointLabel: 'endpoint',
  languageLabel: 'idioma',
  languageValue: 'Português',
  setupLabel: 'SETUP',
  mouseLabel: 'mouse',
  mouseOn: 'ligado',
  mouseOff: 'desligado',

  pidLabel: 'pid',
  uptimeLabel: 'no ar há',
  webLabel: 'web',
  apiLabel: 'api',
  noServices: 'nada detectado ainda.',
  bootLabel: 'boot',
  bootOn: 'inicia no boot',
  bootOff: 'não inicia no boot',

  actStop: 'Parar',
  actOpen: 'Abrir no navegador',
  actStopAll: 'Parar tudo',
  actRestartAll: 'Reiniciar tudo',
  actUpgrade: (v) => `Atualizar para v${v} e reiniciar`,
  actConnect: 'Conectar',
  actDisconnect: 'Desconectar',
  actHistory: 'Mudar',
  actLanguage: 'Trocar',
  actMouse: 'Trocar',
  actBoot: 'Iniciar no boot',

  stateUp: 'no ar',
  stateDown: 'parado',
  stateUnknown: 'desconhecido',
  stateConflict: 'conflito',

  working: 'trabalhando',
  yes: 'Sim',
  no: 'Não',

  killQuestion: 'Já existe um servidor rodando aqui — parar e iniciar outro?',

  setupIntro: 'Como esta máquina registra o uso, e o que sai dela.',
  setupSolo: 'solo',
  setupSoloHint: 'só local — nada sai desta máquina',
  setupCentral: 'central',
  setupCentralHint: 'hospedar a central do time (Docker) aqui',
  setupMember: 'member',
  setupMemberHint: 'tudo que o solo faz, e ainda envia métricas (nunca chat) para uma central',
  archiveUnset: 'ainda não escolhido',
  archiveQuestion: 'Preservar o histórico de sessões?',
  archiveWhy: 'O Claude apaga transcrições de sessão com mais de 30 dias.',
  archiveConsolidate: 'consolidate',
  archiveConsolidateHint: 'recomendado — guarda as métricas por sessão já calculadas (~KB cada)',
  archiveFull: 'full',
  archiveFullHint: 'arquivista — também espelha as transcrições cruas para reler os chats (pesado)',
  archiveOff: 'off',
  archiveOffHint: 'não fazer nada — usar a limpeza padrão de 30 dias do Claude',
  archiveLater: 'decidir depois',
  archiveLaterHint: 'a interface vai exigir a resposta antes de abrir',
  archiveLaterMessage: 'Histórico sem definição — a interface vai perguntar antes de abrir.',
  bootQuestion: 'Iniciar também no boot (serviço systemd de usuário)?',

  logSource: 'FONTE',
  logEmpty: 'nada registrado ainda.',
  logLoading: 'lendo…',
  logFollow: 'f acompanhar',
  logFollowing: 'acompanhando',
  logPaused: 'pausado',

  sessionsEmpty: 'nenhuma sessão em execução.',
  sessionsLoading: 'lendo…',
  sessionsUnsupported: 'gerenciamento de sessões não está disponível nesta máquina.',
  sessionsCount: (n: number) => (n === 1 ? '1 sessão' : `${n} sessões`),
  sessionsWaitingCount: (n: number) => (n === 1 ? '1 esperando por você' : `${n} esperando por você`),
  sessionsGroupBy: 'AGRUPAR',
  sessionsGroupings: {
    task: 'tarefa',
    none: 'lista',
    harness: 'harness',
    model: 'modelo',
    project: 'projeto',
  },
  sessionsUnknownHarness: 'harness desconhecido',
  sessionsUnknownModel: 'sem modelo registrado',
  sessionsUnknownProject: 'sem diretório registrado',
  sessionsUnknownTask: 'sem tarefa',
  sessionsWhere: 'onde',
  sessionsModel: 'modelo',
  sessionsNote: 'nota',
  sessionsStarted: 'iniciada',
  sessionsDoing: 'dizendo',
  sessionsTask: 'tarefa',
  sessionsMetrics: 'uso',
  sessionsAgo: (sec: number) => {
    if (sec < 60) return `há ${sec}s`
    const min = Math.round(sec / 60)
    if (min < 60) return `há ${min}min`
    return `há ${Math.floor(min / 60)}h ${min % 60}min`
  },
  sessionsExternalNote: 'iniciada fora do agentop — listada, mas não dá para anexar nem parar por aqui.',
  sessionsClosedNote: 'não está rodando — reabra para retomar esta conversa.',
  keySessionsGroup: 'v agrupar',
  keySessionsAttach: '⏎ anexar',
  keySessionsKill: 'x encerrar',
  keySessionsRename: 'n nomear',
  keySessionsNote: 't nota',
  keySessionsNew: 'a nova',
  keySessionsSearch: '/ buscar',
  keySessionsActions: 'tab ações',
  actSessions: {
    attach: 'Anexar',
    resume: 'Reabrir',
    rename: 'Renomear',
    note: 'Nota',
    task: 'Tarefa',
    kill: 'Encerrar',
    openTask: 'Abrir tarefa toda',
    newSession: 'Nova sessão',
    search: 'Buscar',
    group: 'Agrupar',
  },
  sessionsTaskPrompt: 'De qual tarefa esta sessão faz parte?',
  sessionsOpenTaskConfirm: (task: string, n: number) =>
    `Reabrir todas as ${n} sessão(ões) de "${task}" em background?`,
  sessionsResumeConfirm: (title: string) => `Reabrir "${title}" como sessão gerenciada pelo agentop?`,
  sessionsResumeRunning:
    'o assistente que já roda ali NÃO é encerrado — feche ele antes, ou você fica com dois na mesma conversa.',
  sessionsSearchLabel: 'Buscar sessões e conversas fechadas',
  sessionsSearchEmpty: 'nada corresponde.',
  sessionsClosedWord: 'fechada',
  sessionsShowClosed: 'fechadas: visíveis',
  sessionsHideClosed: 'fechadas: ocultas',
  keySessionsClosed: 'c fechadas',
  keySessionsNoTask: 'u sem tarefa',
  sessionsNoTaskHidden: 'sem tarefa: ocultas',
  sessionsNoTaskShown: 'sem tarefa: visíveis',
  wizHarness: 'Qual assistente?',
  wizWhere: 'Onde ela começa?',
  wizWhereHint: 'busque qualquer pasta na sua home — ou cole um caminho completo',
  wizModel: 'Qual modelo?',
  wizModelHint: 'escolha um, ou digite qualquer nome de modelo',
  wizEffort: 'Qual nível de raciocínio?',
  wizPrompt: 'Primeiro prompt (opcional)',
  wizPromptHint: 'deixe vazio para começar sem nada digitado',
  wizHow: 'Iniciar como?',
  wizAttached: 'anexada — assume este terminal agora',
  wizBackground: 'background — deixa rodando e fica aqui',
  wizSkip: 'usar o padrão',
  wizNoMatch: 'nada corresponde — cole um caminho completo para usar um diretório sem histórico',
  wizSourceCwd: 'você está aqui',
  wizSourceTyped: 'digitado',
  wizSourceHistory: 'já trabalhou aqui',
  wizSourceRepo: 'repo git',
  sessionsRenamePrompt: 'Dê um nome a esta sessão',
  sessionsNotePrompt: 'Descreva esta sessão',
  sessionsKillConfirm: (title: string) => `Encerrar "${title}"? O assistente que roda nela é finalizado.`,
  sessionsNotActionable: 'essa sessão não foi iniciada pelo agentop, então não dá para controlá-la daqui.',

  helpIntro: 'Todos os comandos, com as flags que importam. `agentop --help` imprime isto puro.',
  cheatIntro: 'Os comandos que vale a pena lembrar.',
  contributeIntro: 'Agentistics é open source — issues e pull requests são bem-vindos.',
  copyHint: 'selecione com o mouse para copiar',
  copyHintShift: 'segure shift e arraste para selecionar e copiar',
}

const TABLE: Record<CliLang, ControlStrings> = { en: EN, pt: PT }

export function controlStrings(lang: CliLang): ControlStrings {
  return TABLE[lang] ?? EN
}
