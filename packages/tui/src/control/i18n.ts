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
  /** The sessions detail pane's two rules: the facts about the row, and the picture of it. */
  sectionSession: string
  sectionFrame: string

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

  /** Sessions tab. */
  /**
   * The list's column headers, lowercase like every other row label in this app.
   *
   * `name` rather than `label`: the cell holds the user's label when there is one, the id they
   * would type at `agentop session` when there is not, and an external row's directory — see
   * `sessionName`. Naming the column after one of the three would misname the other two.
   */
  sessionColState: string
  sessionColHarness: string
  sessionColName: string
  sessionColDir: string

  /**
   * Every `SessionState`, as a WORD.
   *
   * The state is the one thing on a row that does not arrive already localized, and it is the cell
   * the row may never give up — a colour alone is not a state. The three quiet ones are three
   * DIFFERENT facts and none of them may be worded as "idle": `unclear` is "the frame was read and
   * nothing in it said anything", `unreadable` is "the frame could not be read at all", and
   * `external` is a process that never had a pane to read.
   */
  sessionStateWorking: string
  sessionStateApproval: string
  sessionStateInput: string
  sessionStateUnclear: string
  sessionStateUnreadable: string
  sessionStateExited: string
  sessionStateExternal: string

  /**
   * The reasons behind the three quiet states, in words, for the detail pane.
   *
   * `sessionExternalWhy` is the rendering of `SessionView.externalReason` — the second un-localized
   * enum on a row. Without it an external session offers no verbs and never says why, which is the
   * most confusing thing this pane could do.
   */
  sessionUnclearWhy: string
  sessionUnreadableWhy: string
  sessionExternalWhy: string

  /** Nothing running here — a real empty fleet, never the answer to "sessions cannot be read". */
  sessionsEmpty: string
  /**
   * Said before the FIRST snapshot lands, and only then.
   *
   * A screen of its own rather than `sessionsEmpty` shown early: "no sessions on this machine yet"
   * drawn while nobody has looked is the confident zero this codebase keeps out of every other
   * surface, and reading the fleet costs one capture per running session — long enough to be seen.
   */
  sessionsLoading: string
  /** How many rows are waiting on the user right now. Shown as the screen's own badge. */
  sessionsAttention: (n: number) => string
  /** Said on the row you are already inside — it is why this terminal shows what it shows. */
  sessionAttached: string
  /**
   * The refusal `attachCommand()` cannot word.
   *
   * It returns `string[] | null` and carries no message, deliberately (see `cli-i18n.ts`), so the
   * sentence for a `null` is the TUI's. Normally the verb is simply ABSENT for a row that is not
   * attachable; this is what the screen says when the answer arrives as no anyway — the session
   * exited, or was killed, between the frame and the keypress.
   */
  sessionNotAttachable: string

  /** The sessions detail pane's row labels. `uptimeLabel` is reused for the age. */
  sessionHarnessLabel: string
  sessionModelLabel: string
  sessionEffortLabel: string
  sessionDirLabel: string
  sessionLastLabel: string
  sessionNoteLabel: string

  /** The verbs on a session row. `New session` is the one that acts on no row at all. */
  actAttach: string
  actNewSession: string
  actRename: string
  actNote: string
  actKill: string

  /**
   * The three questions a session row can raise.
   *
   * The kill question NAMES the row (`sessionName` — the label, the id, or the directory), because
   * it is the one irreversible verb on this screen and "kill it?" beside a list whose cursor the
   * question is drawn over answers "which one?" with a shrug. The other two are prompts, and their
   * placeholders are the CURRENT value: a rename that starts empty hides what it is replacing.
   */
  sessionKillQuestion: (name: string) => string
  sessionRenamePrompt: string
  sessionNotePrompt: string

  /**
   * The new-session wizard's steps, each named by the question it asks.
   *
   * The directory step's placeholder says a path may be TYPED, because the picker answers "where
   * have I worked", not "what exists on disk" — a directory this machine has never recorded is
   * still a perfectly good place to start a session, and a search box that looked closed would hide
   * that.
   */
  sessionStepHarness: string
  sessionStepProject: string
  sessionStepModel: string
  sessionStepEffort: string
  sessionStepPrompt: string
  sessionStepLabel: string
  sessionSearchHint: string

  /**
   * The Sessions screen's key hints.
   *
   * The letters avoid every key the shell answers globally (`q`, `r`, `m`) and both vi movement
   * keys (`j`/`k`) — `k` for "kill" would have been the same keypress as "up".
   */
  keyAttach: string
  keyNewSession: string
  keyRename: string
  keyNote: string
  keyKill: string

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
  sectionSession: 'SESSION',
  sectionFrame: 'LAST FRAME',

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

  sessionColState: 'state',
  sessionColHarness: 'harness',
  sessionColName: 'name',
  sessionColDir: 'directory',

  sessionStateWorking: 'working',
  sessionStateApproval: 'needs approval',
  sessionStateInput: 'needs input',
  sessionStateUnclear: 'unclear',
  sessionStateUnreadable: 'unreadable',
  sessionStateExited: 'exited',
  sessionStateExternal: 'external',

  sessionUnclearWhy: 'its last frame was read and nothing in it says what is happening.',
  sessionUnreadableWhy: 'its last frame could not be read, so what it is doing is unknown.',
  sessionExternalWhy:
    'not hosted by agentop — this machine only saw the process, so it cannot be attached, renamed or killed from here.',

  sessionsEmpty: 'no sessions on this machine yet.',
  sessionsLoading: 'reading the fleet…',
  sessionsAttention: (n) => `${n} waiting on you`,
  sessionAttached: 'attached',
  sessionNotAttachable: 'that session cannot be attached — it is gone, or its command has exited.',

  sessionHarnessLabel: 'harness',
  sessionModelLabel: 'model',
  sessionEffortLabel: 'effort',
  sessionDirLabel: 'dir',
  sessionLastLabel: 'last',
  sessionNoteLabel: 'note',

  actAttach: 'Attach',
  actNewSession: 'New session',
  actRename: 'Rename',
  actNote: 'Note',
  actKill: 'Kill',

  sessionKillQuestion: (name) => `Kill ${name} and forget it?`,
  sessionRenamePrompt: 'New label for this session',
  sessionNotePrompt: 'Note on this session',

  sessionStepHarness: 'Which assistant?',
  sessionStepProject: 'Where should it run?',
  sessionStepModel: 'Which model?',
  sessionStepEffort: 'How much effort?',
  sessionStepPrompt: 'First prompt (optional)',
  sessionStepLabel: 'Label it (optional)',
  sessionSearchHint: 'type to search — or type a path',

  keyAttach: 'enter attach',
  keyNewSession: 'n new',
  keyRename: 'R rename',
  keyNote: 'N note',
  keyKill: 'x kill',

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
  sectionSession: 'SESSÃO',
  sectionFrame: 'ÚLTIMO FRAME',

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

  sessionColState: 'estado',
  sessionColHarness: 'harness',
  sessionColName: 'nome',
  sessionColDir: 'diretório',

  sessionStateWorking: 'trabalhando',
  sessionStateApproval: 'precisa aprovar',
  sessionStateInput: 'esperando instrução',
  sessionStateUnclear: 'indefinido',
  sessionStateUnreadable: 'ilegível',
  sessionStateExited: 'encerrada',
  sessionStateExternal: 'externa',

  sessionUnclearWhy: 'o último frame foi lido e nada nele diz o que está acontecendo.',
  sessionUnreadableWhy: 'não deu para ler o último frame, então não dá para saber o que ela está fazendo.',
  sessionExternalWhy:
    'não é hospedada pelo agentop — esta máquina só viu o processo, então não dá para anexar, renomear nem encerrar por aqui.',

  sessionsEmpty: 'nenhuma sessão nesta máquina ainda.',
  sessionsLoading: 'lendo as sessões…',
  sessionsAttention: (n) => `${n} esperando você`,
  sessionAttached: 'anexada',
  sessionNotAttachable: 'não dá para anexar nessa sessão — ela sumiu, ou o comando dela já terminou.',

  sessionHarnessLabel: 'harness',
  sessionModelLabel: 'modelo',
  sessionEffortLabel: 'esforço',
  sessionDirLabel: 'dir',
  sessionLastLabel: 'última',
  sessionNoteLabel: 'nota',

  actAttach: 'Anexar',
  actNewSession: 'Nova sessão',
  actRename: 'Renomear',
  actNote: 'Nota',
  actKill: 'Encerrar',

  sessionKillQuestion: (name) => `Encerrar ${name} e esquecer dela?`,
  sessionRenamePrompt: 'Novo nome para esta sessão',
  sessionNotePrompt: 'Nota nesta sessão',

  sessionStepHarness: 'Qual assistente?',
  sessionStepProject: 'Onde ela vai rodar?',
  sessionStepModel: 'Qual modelo?',
  sessionStepEffort: 'Quanto esforço?',
  sessionStepPrompt: 'Primeiro prompt (opcional)',
  sessionStepLabel: 'Dê um nome (opcional)',
  sessionSearchHint: 'digite para buscar — ou digite um caminho',

  keyAttach: 'enter anexar',
  keyNewSession: 'n nova',
  keyRename: 'R renomear',
  keyNote: 'N nota',
  keyKill: 'x encerrar',

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
