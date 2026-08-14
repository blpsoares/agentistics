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
  /** The list is empty because `only active` is on, and this many sessions are being withheld. */
  sessionsEmptyActive: (total: number) => string
  /** The list is empty because a search or a scope is narrowing it. */
  sessionsEmptyFiltered: string
  sessionsLoading: string
  /** Said when the host does not implement the fleet at all — not the same as an empty fleet. */
  sessionsUnsupported: string
  /** The summary row: "3 sessions · 1 waiting on you". */
  /**
   * How many rows are ON SCREEN, and out of how many the machine has.
   *
   * Two numbers, always, because one of them alone lies: with `only active` on, a fleet of 44 shows
   * ten rows, and a header reading "44 sessions" over ten of them describes a screen nobody is
   * looking at. `shown === total` is the case where the second number says nothing new, and that is
   * the only case where it is dropped.
   */
  sessionsCount: (shown: number, total: number) => string
  sessionsWaitingCount: (n: number) => string
  sessionsGroupBy: string
  sessionsGroupings: Record<'none' | 'harness' | 'model' | 'project' | 'task' | 'repo', string>
  sessionsUnknownHarness: string
  sessionsUnknownModel: string
  sessionsUnknownProject: string
  sessionsUnknownTask: string
  sessionsUnknownRepo: string
  sessionsWorktreeTag: string
  /** The sessions list's column headings — an unlabelled column is one you have to learn. */
  sessionsCols: Record<'id' | 'state' | 'age' | 'title' | 'task' | 'worktree' | 'metrics' | 'harness' | 'where', string>
  /** Detail-pane field labels. */
  sessionsWhere: string
  sessionsModel: string
  sessionsNote: string
  sessionsStarted: string
  sessionsDoing: string
  sessionsTask: string
  sessionsMetrics: string
  /** The name that did NOT win, when a session is named in agentop AND inside the harness. */
  sessionsAlsoLabel: string
  sessionsAlsoHarness: string
  /** Label of the detail line stating how to LEAVE an attached session. */
  sessionsDetach: string
  /** Marks a finished task's heading, and the word the toggle uses. */
  sessionsDoneWord: string
  /** Pane titles — the SHORT lowercase names, the same words the tab bar prints. */
  sessionsPaneMenu: string
  sessionsPaneDetail: string
  sessionsPaneAsk: string
  sessionsPaneKeys: string
  sessionsPaneRestore: string
  restoreTitle: (n: number) => string
  restoreAnswer: string
  /** What each key on the sessions screen does — the one list `ctrl+h` prints. */
  sessionsKeyWhat: {
    move: string; open: string; attach: string; menu: string; section: string
    newSession: string; search: string; clear: string; kill: string; rename: string
    note: string; task: string; mark: string; onlyActive: string; closed: string
    exited: string; unfiled: string; group: string; detail: string; menuFold: string
    reset: string
    tabs: string; help: string; quit: string
    approve: string; prompt: string; reopenFell: string
  }
  /**
   * The finish-task confirmation.
   *
   * It states what finishing a task ACTUALLY does, which is hide its sessions behind a switch —
   * nothing is stopped and nothing is deleted, and `running` is called out separately because a
   * warning that implied otherwise would be worse than no warning at all. See `finishTask` in
   * `cli-start.ts`.
   */
  sessionsFinishConfirm: (task: string, count: number, running: number) => string
  sessionsReopenConfirm: (task: string) => string
  /** The heading over the sessions the machine took at once. */
  sessionsFellWord: string
  /** Said on the summary row and in the empty state: N fell, this long ago, and the key. */
  sessionsFellNote: (count: number, ago: string) => string
  /** The confirmation, naming how many and when. */
  sessionsFellConfirm: (count: number, ago: string) => string
  /** The prompt field, and the sentence above it saying where the text is going. */
  sessionsPromptLabel: (title: string) => string
  sessionsPromptHint: string
  /** The approval confirmation — and its caveat, which is the whole design. */
  sessionsApproveConfirm: (title: string) => string
  sessionsApproveCaveat: string
  /** Heading over the dialog lines carried into the confirmation. */
  sessionsApproveWhat: string
  asideProjects: string
  asideAllProjects: string
  toggleDone: string
  /** The strict switch: only what is running. Overrides the other three. */
  toggleActive: string
  /** The detail pane's own switch: it is a pane, not a fact, and a screen is allowed to be a list. */
  toggleDetail: string
  /** Written on the detail pane itself: the key that puts it away. */
  sessionsDetailHide: string
  /** The menu's layout section, and what the two layouts are called. */
  asideLayout: string
  sessionsLayouts: Record<'list' | 'cards', string>
  /** The card pager: which page, and how much of the fleet is on it. */
  sessionsPage: (page: number, pages: number) => string
  sessionsShowing: (shown: number, total: number) => string
  /** Card markers — said on the state line, where a row has no room for them. */
  sessionsCardAttached: string
  sessionsCardBlind: string
  keySessionsLayout: string
  keySessionsCard: string
  keySessionsPage: string
  asideSort: string
  asideStates: string
  sessionsSorts: Record<'state' | 'name' | 'started' | 'usage' | 'project', string>
  sessionsStates: Record<
    'working' | 'waiting' | 'waiting-approval' | 'exited' | 'lost' | 'closed' | 'unknown', string
  >
  /** States the active search on the summary row, and how to drop it. */
  sessionsSearching: (query: string) => string
  /** How long ago, from a whole number of SECONDS — the caller does the clock arithmetic so this
   *  stays a pure formatter. */
  sessionsAgo: (seconds: number) => string
  /** The external row's own sentence, in the detail pane. */
  sessionsExternalNote: string
  sessionsClosedNote: string
  keySessionsGroup: string
  keySessionsAttach: string
  /** How to put the arrangement back to how the app opens on a fresh machine. */
  keySessionsReset: string
  keySessionsKill: string
  keySessionsRename: string
  keySessionsNote: string
  keySessionsNew: string
  keySessionsSearch: string
  keySessionsActions: string
  keySessionsApprove: string
  keySessionsPrompt: string
  /** The menu fold — the plain letter, because tmux's default prefix never arrives inside a tmux. */
  keySessionsFold: string
  /** The two keys the restore offer answers, and nothing else. */
  keyRestoreAnswer: string
  /** The visible action row — the same verbs the letters run, spelled out and clickable. */
  actSessions: {
    attach: string
    resume: string
    rename: string
    note: string
    task: string
    approve: string
    prompt: string
    kill: string
    openTask: string
    reopenFell: string
    finishTask: string
    newSession: string
    search: string
    group: string
  }
  sessionsTaskPrompt: string
  taskHint: string
  taskNone: string
  taskCurrent: string
  sessionsOpenTaskConfirm: (task: string, n: number) => string
  sessionsResumeConfirm: (title: string) => string
  sessionsResumeRunning: string
  sessionsSearchLabel: string
  sessionsSearchEmpty: string
  sessionsClosedWord: string
  sessionsShowClosed: string
  /** The view panel: one vertical list of every choice about what the list shows. */
  viewTitle: string
  viewGroupBy: string
  viewShow: string
  viewActiveOn: string
  viewClosedOn: string
  viewClosedOff: string
  viewUnfiledOn: string
  viewUnfiledOff: string
  viewHint: string
  /** The aside menu's three headings, and the third visibility switch. */
  asideActions: string
  asideView: string
  asideShow: string
  asideTasks: string
  asideAllTasks: string
  toggleClosed: string
  toggleExited: string
  toggleUnfiled: string
  keySessionsAside: string
  /** The management view a session opens into. */
  manageTitle: (title: string) => string
  manageHint: string
  promptHint: string
  sessionsHideClosed: string
  keySessionsActive: string
  keySessionsDetail: string
  keySessionsMark: string
  keySessionsClosed: string
  keySessionsNoTask: string
  /** How to change screen where the arrows belong to the screen itself. */
  keyTabsAlt: string
  /** How to jump between the menu's sections without walking every row of one. */
  keyAsideSection: string
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
  wizName: string
  wizNameHint: string
  wizHow: string
  /** Said while the session is being started, so `enter` is visibly doing something. */
  wizStarting: string
  /** Said under a failure: nothing you typed was thrown away. */
  wizKeptDraft: string
  wizNoSpawn: string
  wizNeedHarness: string
  wizNeedCwd: string
  wizAttached: string
  wizBackground: string
  wizSkip: string
  wizNoMatch: string
  /** The project table's column headings — four unlabelled columns are four columns of guesswork. */
  wizColName: string
  wizColRepo: string
  wizColPath: string
  wizColWhy: string
  /** Heading over the candidates that belong to no repository. */
  wizNoRepo: string
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
  /** Said when the approve key is pressed on a session that is not blocked on anything. */
  sessionsNotAsking: string
  /** Said when "reopen what fell" is pressed and nothing did. */
  sessionsNoFell: string

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
  sessionsEmptyActive: (total: number) =>
    `nothing running · ${total} session${total === 1 ? '' : 's'} withheld — l shows them`,
  sessionsEmptyFiltered: 'nothing matches · esc clears the filter',
  sessionsLoading: 'reading…',
  sessionsUnsupported: 'session management is not available on this machine.',
  sessionsCount: (shown: number, total: number) => (shown === total
    ? (total === 1 ? '1 session' : `${total} sessions`)
    : `${shown} of ${total} sessions`),
  sessionsWaitingCount: (n: number) => (n === 1 ? '1 waiting on you' : `${n} waiting on you`),
  sessionsGroupBy: 'GROUP',
  sessionsGroupings: {
    repo: 'repository',
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
  sessionsUnknownRepo: 'no repository',
  /** Said on a row whose directory is a linked worktree. Short: it is a CELL, not a sentence. */
  sessionsWorktreeTag: 'worktree',
  sessionsCols: {
    id: 'id',
    state: 'state',
    age: 'started',
    title: 'session',
    task: 'task',
    worktree: 'worktree',
    metrics: 'usage',
    harness: 'harness',
    where: 'project',
  },
  sessionsWhere: 'where',
  sessionsModel: 'model',
  sessionsNote: 'note',
  sessionsStarted: 'started',
  sessionsDoing: 'saying',
  sessionsTask: 'task',
  sessionsMetrics: 'usage',
  sessionsAlsoLabel: 'named here',
  sessionsAlsoHarness: 'named inside',
  sessionsDetach: 'to detach',
  sessionsDoneWord: 'finished',
  sessionsPaneMenu: 'menu',
  sessionsPaneDetail: 'detail',
  sessionsPaneAsk: 'question',
  sessionsPaneKeys: 'keys',
  sessionsPaneRestore: 'last time',
  restoreTitle: (n: number) =>
    n === 1 ? 'Your last session was this one:' : `Your last ${n} sessions were these:`,
  restoreAnswer: 'enter starts them in the background · esc leaves them closed',
  sessionsKeyWhat: {
    move: 'move the cursor',
    open: 'switch between the menu and the list',
    attach: 'attach — or reopen, when nothing is running',
    menu: 'open the menu on this row',
    section: 'jump to a menu section',
    newSession: 'start a session',
    search: 'search everything, closed conversations included',
    clear: 'drop the search, then the project, then the task',
    kill: 'stop this session',
    rename: 'rename it',
    note: 'write a note on it',
    task: 'file it under a task',
    mark: 'mark this row, and keep it marked',
    onlyActive: 'show only what is running',
    closed: 'show closed conversations',
    exited: 'show sessions that ended',
    unfiled: 'show sessions under no task',
    group: 'change the grouping',
    detail: 'hide the detail pane',
    menuFold: 'fold the menu away — any digit brings it back',
    reset: 'back to how the app opens',
    tabs: 'change screen',
    help: 'this list',
    quit: 'leave agentop',
    approve: 'answer the question this session is blocked on',
    prompt: 'send it a line without attaching',
    reopenFell: 'reopen everything the machine took at once',
  },
  // Says what finishing ACTUALLY does. It marks the task and hides its sessions behind a switch —
  // it stops nothing — so the sentence names the count, calls out the ones still running, and names
  // the switch that brings them back.
  sessionsFinishConfirm: (task, count, running) =>
    `Mark "${task}" finished? Its ${count} session${count === 1 ? '' : 's'}`
    + `${running > 0 ? ` (${running} still running)` : ''}`
    + (count === 1
      ? ' is NOT stopped — it keeps running and stays'
      : ' are NOT stopped — they keep running and stay')
    + ' listed behind the "finished tasks" switch.',
  sessionsReopenConfirm: task => `Reopen "${task}"?`,
  sessionsFellWord: 'fell together',
  sessionsFellNote: (count, ago) =>
    `${count} session${count === 1 ? '' : 's'} fell ${ago} — R reopens them`,
  sessionsFellConfirm: (count, ago) =>
    `Reopen the ${count} session${count === 1 ? '' : 's'} that fell ${ago}? `
    + 'Each comes back as a new session resuming its own conversation; anything still running is left alone.',
  sessionsPromptLabel: (title: string) => `Send to "${title}"`,
  sessionsPromptHint: 'typed straight into the session — it reads it when it gets there',
  sessionsApproveConfirm: (title: string) => `Send the confirm key to "${title}"?`,
  sessionsApproveCaveat:
    'it takes whichever option the dialog above has highlighted — read it first.',
  sessionsApproveWhat: 'on its screen right now',
  asideProjects: 'PROJECTS',
  asideAllProjects: 'every project',
  toggleDone: 'finished tasks',
  toggleActive: 'only active',
  toggleDetail: 'detail pane',
  sessionsDetailHide: 'd hides',
  asideLayout: 'LAYOUT',
  sessionsLayouts: { list: 'list', cards: 'cards' },
  sessionsPage: (page, pages) => `${page} / ${pages}`,
  sessionsShowing: (shown, total) => `${shown} of ${total}`,
  sessionsCardAttached: 'attached',
  sessionsCardBlind: 'approval unknown',
  keySessionsLayout: 'f list/cards',
  keySessionsCard: '←→ card',
  keySessionsPage: 'pgup/pgdn page',
  asideSort: 'ORDER',
  asideStates: 'STATE',
  sessionsSorts: {
    state: 'urgency', name: 'name', started: 'started', usage: 'usage', project: 'project',
  },
  sessionsStates: {
    'waiting-approval': 'needs approval',
    waiting: 'waiting',
    working: 'working',
    exited: 'exited',
    lost: 'lost',
    closed: 'closed',
    unknown: 'external',
  },
  sessionsSearching: q => `search: ${q} · esc clears`,
  sessionsAgo: (sec: number) => {
    if (sec < 60) return `${sec}s ago`
    const min = Math.round(sec / 60)
    if (min < 60) return `${min}m ago`
    return `${Math.floor(min / 60)}h ${min % 60}m ago`
  },
  sessionsExternalNote: 'started outside agentop — listed, but it cannot be attached or stopped here.',
  sessionsClosedNote: 'not running — reopen it to pick this conversation back up.',
  keySessionsGroup: 'v group',
  keySessionsAttach: 'o attach',
  keySessionsReset: '^r reset view',
  keySessionsKill: 'x kill',
  keySessionsRename: 'n name',
  keySessionsNote: 't note',
  keySessionsNew: 'a new',
  keySessionsSearch: '/ search',
  keySessionsActions: 'tab actions',
  keySessionsApprove: 'y approve',
  keySessionsPrompt: 'p send',
  keySessionsFold: 'b menu',
  keyRestoreAnswer: 'enter start · esc leave closed',
  actSessions: {
    attach: 'Attach',
    resume: 'Reopen',
    // "Answer" rather than "Approve": the key takes whichever option is highlighted, and the verb
    // must not promise more than the keystroke can deliver.
    approve: 'Answer its question',
    prompt: 'Send a prompt',
    rename: 'Rename',
    note: 'Note',
    task: 'Task',
    kill: 'Stop session',
    openTask: 'Open whole task',
    reopenFell: 'Reopen what fell',
    finishTask: 'Finish task',
    newSession: 'New session',
    search: 'Search',
    group: 'Group',
  },
  sessionsTaskPrompt: 'Which task does this session belong to?',
  taskHint: 'pick one, or type a new name',
  taskNone: 'no task',
  taskCurrent: '(current)',
  sessionsOpenTaskConfirm: (task: string, n: number) =>
    `Reopen all ${n} session(s) of "${task}" in the background?`,
  sessionsResumeConfirm: (title: string) => `Reopen "${title}" as a session agentop manages?`,
  sessionsResumeRunning:
    'the assistant already running there is NOT stopped — close it first, or you will have two on one conversation.',
  sessionsSearchLabel: 'Search sessions and closed conversations',
  sessionsSearchEmpty: 'nothing matches.',
  sessionsClosedWord: 'closed',
  sessionsShowClosed: 'closed: shown',
  viewTitle: 'What this list shows',
  viewGroupBy: 'Group by',
  viewShow: 'Show',
  viewActiveOn: 'everything but active',
  viewClosedOn: 'closed conversations',
  viewClosedOff: 'closed conversations',
  viewUnfiledOn: 'sessions with no task',
  viewUnfiledOff: 'sessions with no task',
  viewHint: '↑↓ move · enter choose · esc close',
  asideActions: 'ACTIONS',
  asideView: 'VIEW',
  asideShow: 'SHOW',
  asideTasks: 'TASKS',
  asideAllTasks: 'every task',
  toggleClosed: 'closed conversations',
  toggleExited: 'finished sessions',
  toggleUnfiled: 'sessions with no task',
  keySessionsAside: 'tab menu',
  manageTitle: (title: string) => `Managing "${title}"`,
  manageHint: '↑↓ move · enter run · esc back to the list',
  promptHint: 'enter saves · esc cancels',
  sessionsHideClosed: 'closed: hidden',
  keySessionsActive: 'l only active',
  keySessionsDetail: 'd detail',
  keySessionsMark: 'space mark',
  keySessionsClosed: 'c closed',
  keySessionsNoTask: 'u unfiled',
  keyTabsAlt: '[ ] screens',
  keyAsideSection: '1-9 ←→ section',
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
  wizName: 'Call it what?',
  wizNameHint: 'a name of your own — enter alone derives one from the harness and the folder',
  wizHow: 'Start it how?',
  wizStarting: 'starting…',
  wizKeptDraft: 'nothing you typed was lost — esc goes back a step, or try again',
  wizNoSpawn: 'this build cannot start sessions.',
  wizNeedHarness: 'pick an assistant first.',
  wizNeedCwd: 'pick a folder first.',
  wizAttached: 'attached — take this terminal now',
  wizBackground: 'background — keep it running and stay here',
  wizSkip: 'use the default',
  wizNoMatch: 'nothing matches — paste a full path to use a directory anywhere on this machine',
  wizColName: 'folder',
  wizColRepo: 'repository',
  wizColPath: 'path',
  wizColWhy: 'why',
  wizNoRepo: 'no repository',
  wizSourceCwd: 'you are here',
  wizSourceTyped: 'typed',
  wizSourceHistory: 'worked here before',
  wizSourceRepo: 'git repo',
  sessionsRenamePrompt: 'Name this session',
  sessionsNotePrompt: 'Describe this session',
  sessionsKillConfirm: (title: string) => `Stop "${title}"? The assistant running in it is ended.`,
  sessionsNotActionable: 'that session was not started by agentop, so it cannot be driven from here.',
  sessionsNotAsking: 'that session is not blocked on a question — there is nothing to answer.',
  sessionsNoFell: 'nothing fell — no session was lost with the machine still on record.',

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
  sessionsEmptyActive: (total: number) =>
    `nada rodando · ${total} ${total === 1 ? 'sessão retida' : 'sessões retidas'} — l mostra`,
  sessionsEmptyFiltered: 'nada corresponde · esc limpa o filtro',
  sessionsLoading: 'lendo…',
  sessionsUnsupported: 'gerenciamento de sessões não está disponível nesta máquina.',
  sessionsCount: (shown: number, total: number) => (shown === total
    ? (total === 1 ? '1 sessão' : `${total} sessões`)
    : `${shown} de ${total} sessões`),
  sessionsWaitingCount: (n: number) => (n === 1 ? '1 esperando por você' : `${n} esperando por você`),
  sessionsGroupBy: 'AGRUPAR',
  sessionsGroupings: {
    repo: 'repositório',
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
  sessionsUnknownRepo: 'sem repositório',
  sessionsWorktreeTag: 'worktree',
  sessionsCols: {
    id: 'id',
    state: 'estado',
    age: 'iniciada',
    title: 'sessão',
    task: 'tarefa',
    worktree: 'worktree',
    metrics: 'uso',
    harness: 'harness',
    where: 'projeto',
  },
  sessionsWhere: 'onde',
  sessionsModel: 'modelo',
  sessionsNote: 'nota',
  sessionsStarted: 'iniciada',
  sessionsDoing: 'dizendo',
  sessionsTask: 'tarefa',
  sessionsMetrics: 'uso',
  sessionsAlsoLabel: 'nome daqui',
  sessionsAlsoHarness: 'nome de dentro',
  sessionsDetach: 'para sair',
  sessionsDoneWord: 'finalizada',
  sessionsPaneMenu: 'menu',
  sessionsPaneDetail: 'detalhe',
  sessionsPaneAsk: 'pergunta',
  sessionsPaneKeys: 'teclas',
  sessionsPaneRestore: 'da última vez',
  restoreTitle: (n: number) =>
    n === 1 ? 'Sua última sessão foi esta:' : `Suas últimas ${n} sessões foram estas:`,
  restoreAnswer: 'enter inicia em background · esc deixa fechadas',
  sessionsKeyWhat: {
    move: 'move o cursor',
    open: 'alterna entre o menu e a lista',
    attach: 'anexa — ou reabre, quando não há nada rodando',
    menu: 'abre o menu nessa linha',
    section: 'pula para uma seção do menu',
    newSession: 'inicia uma sessão',
    search: 'busca tudo, inclusive conversas fechadas',
    clear: 'limpa a busca, depois o projeto, depois a tarefa',
    kill: 'encerra esta sessão',
    rename: 'renomeia',
    note: 'escreve uma nota nela',
    task: 'arquiva sob uma tarefa',
    mark: 'marca esta linha, e mantém marcada',
    onlyActive: 'mostra só o que está rodando',
    closed: 'mostra conversas fechadas',
    exited: 'mostra sessões encerradas',
    unfiled: 'mostra sessões sem tarefa',
    group: 'muda o agrupamento',
    detail: 'oculta o painel de detalhe',
    menuFold: 'recolhe o menu — qualquer dígito traz de volta',
    reset: 'volta para como o app abre',
    tabs: 'muda de tela',
    help: 'esta lista',
    quit: 'sai do agentop',
    approve: 'responde a pergunta que travou a sessão',
    prompt: 'envia uma linha para ela sem anexar',
    reopenFell: 'reabre tudo que a máquina levou de uma vez',
  },
  sessionsFinishConfirm: (task, count, running) =>
    `Finalizar "${task}"? ${count === 1 ? 'A sessão dela' : `As ${count} sessões dela`}`
    + `${running > 0 ? ` (${running} ainda rodando)` : ''}`
    + (count === 1
      ? ' NÃO é encerrada — continua rodando e fica listada'
      : ' NÃO são encerradas — continuam rodando e ficam listadas')
    + ' atrás do interruptor "tarefas finalizadas".',
  sessionsReopenConfirm: task => `Reabrir "${task}"?`,
  sessionsFellWord: 'caíram juntas',
  sessionsFellNote: (count, ago) =>
    (count === 1 ? `1 sessão caiu ${ago} — R reabre` : `${count} sessões caíram ${ago} — R reabre todas`),
  sessionsFellConfirm: (count, ago) =>
    (count === 1
      ? `Reabrir a sessão que caiu ${ago}? `
      : `Reabrir as ${count} sessões que caíram ${ago}? `)
    + 'Cada uma volta como uma sessão nova retomando a própria conversa; o que ainda estiver rodando fica como está.',
  sessionsPromptLabel: (title: string) => `Enviar para "${title}"`,
  sessionsPromptHint: 'digitado direto na sessão — ela lê quando chegar lá',
  sessionsApproveConfirm: (title: string) => `Enviar a tecla de confirmação para "${title}"?`,
  sessionsApproveCaveat:
    'ela pega a opção que o diálogo acima está destacando — leia antes.',
  sessionsApproveWhat: 'na tela dela agora',
  asideProjects: 'PROJETOS',
  asideAllProjects: 'todos os projetos',
  toggleDone: 'tarefas finalizadas',
  toggleActive: 'apenas ativas',
  toggleDetail: 'painel de detalhe',
  sessionsDetailHide: 'd oculta',
  asideLayout: 'FORMATO',
  sessionsLayouts: { list: 'lista', cards: 'cards' },
  sessionsPage: (page, pages) => `${page} / ${pages}`,
  sessionsShowing: (shown, total) => `${shown} de ${total}`,
  sessionsCardAttached: 'anexada',
  sessionsCardBlind: 'aprovação incerta',
  keySessionsLayout: 'f lista/cards',
  keySessionsCard: '←→ card',
  keySessionsPage: 'pgup/pgdn página',
  asideSort: 'ORDENAR',
  asideStates: 'ESTADO',
  sessionsSorts: {
    state: 'urgência', name: 'nome', started: 'início', usage: 'uso', project: 'projeto',
  },
  sessionsStates: {
    'waiting-approval': 'precisa aprovação',
    waiting: 'aguardando',
    working: 'trabalhando',
    exited: 'encerrada',
    lost: 'perdida',
    closed: 'fechada',
    unknown: 'externa',
  },
  sessionsSearching: q => `busca: ${q} · esc limpa`,
  sessionsAgo: (sec: number) => {
    if (sec < 60) return `há ${sec}s`
    const min = Math.round(sec / 60)
    if (min < 60) return `há ${min}min`
    return `há ${Math.floor(min / 60)}h ${min % 60}min`
  },
  sessionsExternalNote: 'iniciada fora do agentop — listada, mas não dá para anexar nem parar por aqui.',
  sessionsClosedNote: 'não está rodando — reabra para retomar esta conversa.',
  keySessionsGroup: 'v agrupar',
  keySessionsAttach: 'o anexar',
  keySessionsReset: '^r restaurar view',
  keySessionsKill: 'x encerrar',
  keySessionsRename: 'n nomear',
  keySessionsNote: 't nota',
  keySessionsNew: 'a nova',
  keySessionsSearch: '/ buscar',
  keySessionsActions: 'tab ações',
  keySessionsApprove: 'y aprovar',
  keySessionsPrompt: 'p enviar',
  keySessionsFold: 'b menu',
  keyRestoreAnswer: 'enter inicia · esc deixa fechadas',
  actSessions: {
    attach: 'Anexar',
    resume: 'Reabrir',
    // "Responder", não "Aprovar": a tecla pega a opção destacada, e o verbo não pode prometer mais
    // do que a tecla entrega.
    approve: 'Responder a pergunta',
    prompt: 'Enviar prompt',
    rename: 'Renomear',
    note: 'Nota',
    task: 'Tarefa',
    kill: 'Encerrar sessão',
    openTask: 'Abrir tarefa toda',
    reopenFell: 'Reabrir o que caiu',
    finishTask: 'Finalizar tarefa',
    newSession: 'Nova sessão',
    search: 'Buscar',
    group: 'Agrupar',
  },
  sessionsTaskPrompt: 'De qual tarefa esta sessão faz parte?',
  taskHint: 'escolha uma, ou digite um nome novo',
  taskNone: 'sem tarefa',
  taskCurrent: '(atual)',
  sessionsOpenTaskConfirm: (task: string, n: number) =>
    `Reabrir todas as ${n} sessão(ões) de "${task}" em background?`,
  sessionsResumeConfirm: (title: string) => `Reabrir "${title}" como sessão gerenciada pelo agentop?`,
  sessionsResumeRunning:
    'o assistente que já roda ali NÃO é encerrado — feche ele antes, ou você fica com dois na mesma conversa.',
  sessionsSearchLabel: 'Buscar sessões e conversas fechadas',
  sessionsSearchEmpty: 'nada corresponde.',
  sessionsClosedWord: 'fechada',
  sessionsShowClosed: 'fechadas: visíveis',
  viewTitle: 'O que esta lista mostra',
  viewGroupBy: 'Agrupar por',
  viewShow: 'Mostrar',
  viewActiveOn: 'tudo menos as ativas',
  viewClosedOn: 'conversas fechadas',
  viewClosedOff: 'conversas fechadas',
  viewUnfiledOn: 'sessões sem tarefa',
  viewUnfiledOff: 'sessões sem tarefa',
  viewHint: '↑↓ mover · enter escolher · esc fechar',
  asideActions: 'AÇÕES',
  asideView: 'VER',
  asideShow: 'MOSTRAR',
  asideTasks: 'TAREFAS',
  asideAllTasks: 'todas as tarefas',
  toggleClosed: 'conversas fechadas',
  toggleExited: 'sessões encerradas',
  toggleUnfiled: 'sessões sem tarefa',
  keySessionsAside: 'tab menu',
  manageTitle: (title: string) => `Gerenciando "${title}"`,
  manageHint: '↑↓ mover · enter executar · esc voltar à lista',
  promptHint: 'enter salva · esc cancela',
  sessionsHideClosed: 'fechadas: ocultas',
  keySessionsActive: 'l só ativas',
  keySessionsDetail: 'd detalhe',
  keySessionsMark: 'space marcar',
  keySessionsClosed: 'c fechadas',
  keySessionsNoTask: 'u sem tarefa',
  keyTabsAlt: '[ ] telas',
  keyAsideSection: '1-9 ←→ seção',
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
  wizName: 'Chamar de quê?',
  wizNameHint: 'um nome seu — enter vazio deriva um do harness e da pasta',
  wizHow: 'Iniciar como?',
  wizStarting: 'iniciando…',
  wizKeptDraft: 'nada do que você digitou foi perdido — esc volta um passo, ou tente de novo',
  wizNoSpawn: 'esta build não consegue iniciar sessões.',
  wizNeedHarness: 'escolha um assistente primeiro.',
  wizNeedCwd: 'escolha uma pasta primeiro.',
  wizAttached: 'anexada — assume este terminal agora',
  wizBackground: 'background — deixa rodando e fica aqui',
  wizSkip: 'usar o padrão',
  wizNoMatch: 'nada corresponde — cole um caminho completo para usar um diretório sem histórico',
  wizColName: 'pasta',
  wizColRepo: 'repositório',
  wizColPath: 'caminho',
  wizColWhy: 'por quê',
  wizNoRepo: 'sem repositório',
  wizSourceCwd: 'você está aqui',
  wizSourceTyped: 'digitado',
  wizSourceHistory: 'já trabalhou aqui',
  wizSourceRepo: 'repo git',
  sessionsRenamePrompt: 'Dê um nome a esta sessão',
  sessionsNotePrompt: 'Descreva esta sessão',
  sessionsKillConfirm: (title: string) => `Encerrar "${title}"? O assistente que roda nela é finalizado.`,
  sessionsNotActionable: 'essa sessão não foi iniciada pelo agentop, então não dá para controlá-la daqui.',
  sessionsNotAsking: 'essa sessão não está travada em uma pergunta — não há o que responder.',
  sessionsNoFell: 'nada caiu — nenhuma sessão foi perdida com registro de que estava viva.',

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
