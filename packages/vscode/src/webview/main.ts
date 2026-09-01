/**
 * main.ts — the panel: the fleet, and one session at a time.
 *
 * Two views, one document. `list` is the fleet; `session` is one session's live screen, its
 * composer and its verbs. The sidebar walks between them; an editor TAB is created pinned to a
 * session and never shows the list, which is what lets several be open at once.
 *
 * Built with DOM calls, not `innerHTML`. Every string here is somebody's session title, note, path
 * or a line captured off a terminal, and a template literal is one unescaped `<` away from
 * executing it. There is exactly ONE exception — the terminal screen, whose HTML `ansi.ts` builds
 * and escapes itself — and it is marked at the assignment.
 *
 * It renders and reports intents. It decides nothing about sessions: which verbs a row may take,
 * what each is called, why one is off, whether a session can be typed into and what the screen is
 * showing are all decided upstream — by the server, or by the very modules the dashboard uses.
 */

import { ansiToHtml } from '../ansi'
import { fill } from '../i18n'
import {
  TEXT_VERBS,
  type FleetActionId, type FleetRow, type HostMessage, type LinkStatus,
  type NewOptions, type Route, type SpawnRequest, type ViewMessage,
} from '../protocol'
import { buildView, type FleetView } from '../view-model'
// The browser half of the terminal contract, imported from the dashboard rather than restated: the
// phase machine, the parsers and the SENTENCE that says whether you are looking at a live screen, a
// finished session or one that is gone. A second copy in an editor client would be a second set of
// honesty rules, and the two would disagree about a frozen screen — which is the one thing this
// feature may never be wrong about.
import {
  INITIAL_TERMINAL_STATE, parseEnd, parseFrame, parseOpen, terminalReducer, terminalStatus,
  type TerminalState,
} from '../../../web/src/lib/terminalStream'
import {
  INITIAL_COMPOSER, canEdit, canSubmit, composerReducer, interactionBlock,
  type ComposerState,
} from '../../../web/src/lib/terminalInput'

declare function acquireVsCodeApi(): {
  postMessage(msg: ViewMessage): void
  getState(): unknown
  setState(state: unknown): void
}

const vscode = acquireVsCodeApi()

interface Persisted {
  query: string
  onlyActive: boolean
}

const restored = (vscode.getState() as Persisted | undefined) ?? { query: '', onlyActive: false }

const state = {
  route: { view: 'list' } as Route,
  pinned: false,
  theme: 'dark' as 'dark' | 'light',
  query: restored.query ?? '',
  onlyActive: restored.onlyActive ?? false,
  expanded: null as string | null,
  wizard: false,
  busy: new Set<string>(),
  strings: {} as Record<string, string>,
  lang: 'en' as 'en' | 'pt',
  link: { state: 'down', url: '' } as LinkStatus,
  rows: [] as FleetRow[],
  attention: 0,
  unavailable: undefined as string | undefined,
  tasks: [] as string[],
  options: null as NewOptions | null,
  result: undefined as { ok: boolean; message: string } | undefined,
  /** Per session, so walking away and back does not lose a screen or a half-typed line. */
  terminals: new Map<string, TerminalState>(),
  composers: new Map<string, ComposerState>(),
  /** The session whose stream this surface has asked for. */
  watching: null as string | null,
}

function s(key: string): string {
  return state.strings[key] ?? key
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function post(msg: ViewMessage): void {
  vscode.postMessage(msg)
}

function persist(): void {
  vscode.setState({ query: state.query, onlyActive: state.onlyActive } satisfies Persisted)
}

function rowOf(id: string): FleetRow | undefined {
  return state.rows.find(r => r.id === id)
}

function terminalOf(id: string): TerminalState {
  return state.terminals.get(id) ?? INITIAL_TERMINAL_STATE
}

function composerOf(id: string): ComposerState {
  return state.composers.get(id) ?? INITIAL_COMPOSER
}

// ---------------------------------------------------------------------------
// routing
//
// Watching is tied to the route: entering a session asks for its stream, leaving gives it back. The
// server captures a pane only while somebody is watching, so a surface that forgot to unwatch would
// keep a capture loop running on the host for a screen nobody can see.

function go(route: Route): void {
  const leaving = state.route.view === 'session' ? state.route.id : null
  state.route = route
  const entering = route.view === 'session' ? route.id : null
  if (leaving && leaving !== entering) {
    post({ type: 'unwatch', id: leaving })
    state.watching = null
  }
  if (entering && state.watching !== entering) {
    state.terminals.set(entering, terminalReducer(terminalOf(entering), { type: 'connecting' }))
    post({ type: 'watch', id: entering })
    state.watching = entering
  }
  render()
}

// ---------------------------------------------------------------------------
// the skeleton — built once

const root = document.getElementById('root')!
const header = el('header', 'ag-header')
const banner = el('div', 'banner')
const resultLine = el('div', 'result')
const body = el('main', 'body')

const searchInput = el('input', 'search')
searchInput.type = 'search'
searchInput.value = state.query

function mount(): void {
  root.append(header, banner, resultLine, body)
  searchInput.addEventListener('input', () => {
    state.query = searchInput.value
    persist()
    renderBody()
  })
}

// ---------------------------------------------------------------------------
// chrome

function brand(): HTMLElement {
  const box = el('div', 'brand')
  const mark = el('span', 'brand-mark')
  // The wordmark is TEXT, not an image: a webview reloads on every theme change and a logo that
  // has to be fetched leaves a hole in the header each time.
  mark.textContent = '◧'
  box.append(mark, el('span', 'brand-word', 'agentistics'))
  return box
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, label)
  b.addEventListener('click', onClick)
  return b
}

function renderHeader(): void {
  header.replaceChildren()
  const top = el('div', 'header-top')
  top.append(brand())

  const actions = el('div', 'header-actions')
  if (state.route.view === 'list') {
    actions.append(
      button(s('newSession'), 'btn primary', () => {
        state.wizard = !state.wizard
        if (state.wizard) post({ type: 'newOptions', query: '' })
        renderBody()
      }),
      button(s('dashboard'), 'btn ghost', () => post({ type: 'openDashboard' })),
      button(s('refresh'), 'btn ghost icon', () => post({ type: 'refresh' })),
    )
  } else if (!state.pinned) {
    actions.append(button(`← ${s('backToList')}`, 'btn ghost', () => go({ view: 'list' })))
  }
  top.append(actions)
  header.append(top)

  if (state.attention > 0) {
    const pill = el('div', 'attention')
    pill.append(el('span', 'attention-dot', '●'))
    pill.append(el('span', undefined, state.attention === 1
      ? s('attentionOne')
      : fill(s('attentionMany'), state.attention)))
    header.append(pill)
  }

  if (state.route.view === 'list') {
    const filters = el('div', 'filters')
    searchInput.placeholder = s('searchPlaceholder')
    const toggle = button(s('onlyActive'), state.onlyActive ? 'chip on' : 'chip', () => {
      state.onlyActive = !state.onlyActive
      persist()
      render()
    })
    toggle.setAttribute('aria-pressed', String(state.onlyActive))
    filters.append(searchInput, toggle)
    header.append(filters)
  }
}

function renderBanner(): void {
  banner.replaceChildren()
  // Three link states, three sentences. "Nobody answered" and "answered, and said no" send a
  // person to different places, so they are never collapsed into one message.
  if (state.link.state === 'down') {
    banner.className = 'banner visible bad'
    banner.append(el('span', undefined, fill(s('linkDown'), state.link.url)))
    banner.append(button(s('linkDownAction'), 'btn small', () => post({ type: 'startServer' })))
  } else if (state.link.state === 'refused') {
    banner.className = 'banner visible'
    banner.append(el('span', undefined, state.link.detail ?? s('linkRefused')))
  } else {
    banner.className = 'banner'
  }

  resultLine.replaceChildren()
  resultLine.className = state.result
    ? `result visible ${state.result.ok ? 'ok' : 'bad'}`
    : 'result'
  if (state.result) resultLine.textContent = state.result.message
}

function render(): void {
  renderHeader()
  renderBanner()
  renderBody()
}

function renderBody(): void {
  body.replaceChildren()
  if (state.route.view === 'session') {
    body.append(renderSession(state.route.id))
    return
  }
  if (state.wizard) body.append(renderWizard())
  body.append(renderList())
}

// ---------------------------------------------------------------------------
// the fleet

function renderList(): HTMLElement {
  const box = el('div', 'list')
  const view = buildView(state.rows, { query: state.query, onlyActive: state.onlyActive })

  if (state.unavailable) {
    // The list may not be the whole truth, and the server said why. Shown ABOVE the rows rather
    // than instead of them: a partial answer is still an answer.
    box.append(el('div', 'notice', state.unavailable))
  }
  if (view.empty) {
    box.append(emptyState(view))
    return box
  }

  for (const group of view.groups) {
    const heading = el('div', 'group')
    heading.append(el('span', 'group-name', group.project || '—'))
    heading.append(el('span', 'group-count', String(group.rows.length)))
    box.append(heading)
    for (const row of group.rows) box.append(renderCard(row))
  }
  return box
}

function emptyState(view: FleetView): HTMLElement {
  const box = el('div', 'empty')
  if (view.empty === 'none') {
    box.append(el('p', undefined, s('emptyNone')), el('p', 'dim', s('emptyNoneHint')))
  } else if (view.empty === 'onlyActive') {
    // Naming the switch that is hiding them, and offering to lift it: those rows are still there
    // and still reopenable, and an empty list that does not say which control emptied it reads as
    // a fleet that has vanished.
    box.append(el('p', undefined, s('emptyOnlyActive')), el('p', 'dim', s('emptyOnlyActiveHint')))
    box.append(button(s('emptyOnlyActiveAction'), 'btn small', () => {
      state.onlyActive = false
      persist()
      render()
    }))
  } else {
    box.append(el('p', undefined, fill(s('emptyFiltered'), state.query.trim())))
  }
  return box
}

/** One row, as a card. Clicking it opens the session — the list is a way in, not a control panel. */
function renderCard(row: FleetRow): HTMLElement {
  const card = el('div', `card state-${row.state}`)
  if (state.busy.has(row.id)) card.classList.add('busy')

  const open = el('button', 'card-open')
  open.addEventListener('click', () => go({ view: 'session', id: row.id }))

  const head = el('div', 'card-head')
  head.append(stateDot(row))
  head.append(el('span', 'card-title', row.title))
  head.append(statePill(row))
  open.append(head)

  const meta = el('div', 'card-meta')
  meta.append(harnessChip(row.harness))
  if (row.task) meta.append(el('span', 'chip task', row.task))
  if (row.model) meta.append(el('span', 'chip', row.model))
  open.append(meta)
  open.append(el('div', 'card-cwd', row.cwd))
  if (row.note) open.append(el('div', 'card-note', row.note))
  card.append(open)

  const actions = el('div', 'card-actions')
  actions.append(button(s('openTab'), 'btn tiny ghost', () => post({ type: 'openTab', id: row.id })))
  if (row.actionable) {
    actions.append(button(s('attach'), 'btn tiny ghost', () => post({ type: 'attach', id: row.id })))
  }
  card.append(actions)
  return card
}

function stateDot(row: FleetRow): HTMLElement {
  // The dot costs nothing on a fleet where nothing is waiting, and never carries the message alone:
  // the state word is beside it.
  const dot = el('span', 'dot')
  dot.textContent = row.state === 'waiting' || row.state === 'waiting-approval' ? '●' : '○'
  return dot
}

function statePill(row: FleetRow): HTMLElement {
  return el('span', `state-pill ${row.state}`, row.stateLabel)
}

function harnessChip(harness: string): HTMLElement {
  const chip = el('span', `chip harness h-${harness}`, harness)
  return chip
}

// ---------------------------------------------------------------------------
// one session

function renderSession(id: string): HTMLElement {
  const box = el('div', 'session')
  const row = rowOf(id)
  if (!row) {
    // The fleet no longer carries this id. Said in words, with the way back — a blank pane would
    // read as a broken panel rather than as a session that ended.
    box.append(el('div', 'notice', s('sessionGone')))
    if (!state.pinned) box.append(button(s('backToList'), 'btn', () => go({ view: 'list' })))
    return box
  }

  const head = el('div', 'session-head')
  const title = el('div', 'session-title')
  title.append(stateDot(row), el('span', 'session-name', row.title), statePill(row))
  head.append(title)

  const meta = el('div', 'session-meta')
  meta.append(harnessChip(row.harness))
  if (row.model) meta.append(el('span', 'chip', row.model))
  if (row.task) meta.append(el('span', 'chip task', row.task))
  head.append(meta)
  head.append(el('div', 'session-cwd', row.cwd))
  if (row.note) head.append(el('div', 'session-note', row.note))
  box.append(head)

  const tools = el('div', 'session-tools')
  if (!state.pinned) {
    tools.append(button(s('openTab'), 'btn small ghost', () => post({ type: 'openTab', id })))
  }
  if (row.actionable) {
    tools.append(button(s('attach'), 'btn small', () => post({ type: 'attach', id })))
  }
  tools.append(button(s('copyCommand'), 'btn small ghost', () => post({ type: 'copy', text: row.attachCommand })))
  tools.append(button(s('openFolder'), 'btn small ghost', () => post({ type: 'openFolder', path: row.cwd })))
  box.append(tools)

  if (row.approvalLines?.length || row.dialogOptions?.length) box.append(renderApproval(row))
  box.append(renderScreen(row))
  box.append(renderComposer(row))
  box.append(renderVerbs(row))
  return box
}

/**
 * The dialog a session is blocked on, verbatim, with the options READ OFF THE SCREEN by the server.
 *
 * They are listed and the picked one is sent. A single "approve" button would take whichever row is
 * highlighted, which on "only my fix / promote everything / stop here" is choosing for the user.
 */
function renderApproval(row: FleetRow): HTMLElement {
  const box = el('div', 'approval')
  box.append(el('div', 'approval-title', s('approvalTitle')))
  if (row.approvalLines?.length) {
    const pre = el('pre', 'dialog')
    pre.textContent = row.approvalLines.join('\n')
    box.append(pre)
  }
  if (row.dialogOptions?.length) {
    const options = el('div', 'options')
    for (const option of row.dialogOptions) {
      options.append(button(
        `${option.number}. ${option.label}`,
        option.selected ? 'option selected' : 'option',
        () => act(row.id, 'approve', undefined, option.number),
      ))
    }
    box.append(options)
  } else if (row.approveBlind ?? row.chooseBlind ?? row.approvalBlind) {
    box.append(el('div', 'dim', row.chooseBlind ?? row.approveBlind ?? row.approvalBlind!))
  }
  return box
}

/** How far from the bottom still counts as "following the tail". */
const TAIL_SLACK = 40
let screenEl: HTMLPreElement | null = null
let screenWasAtBottom = true

function renderScreen(row: FleetRow): HTMLElement {
  const box = el('div', 'screen-box')
  const terminal = terminalOf(row.id)
  const status = terminalStatus(terminal, state.lang)

  const pre = el('pre', 'screen')
  // THE ONE PLACE THIS FILE ASSIGNS HTML. `ansiToHtml` escapes the frame before it colours it, and
  // returns spans and text nodes only — see its header. Nothing else here goes near innerHTML.
  pre.innerHTML = terminal.frame ? ansiToHtml(terminal.frame.content, state.theme) : ''
  screenEl = pre
  box.append(pre)

  const line = el('div', 'screen-status')
  line.append(el('span', `pill ${status.tone}`, status.label))
  line.append(el('span', 'dim', status.detail))
  if (status.truncated) line.append(el('span', 'dim', s('screenTruncated')))
  box.append(line)
  return box
}

/**
 * The line composer — consent-gated, exactly as the dashboard's is.
 *
 * Typing into a live session changes another running process mid-work, so it is a deliberate
 * opt-in rather than something that happens because a terminal is on screen. The gate is an INTENT
 * gate and says so: the real authority is the server, which refuses a prompt into an open dialog,
 * into a session that is not running, and on any exposed profile.
 */
function renderComposer(row: FleetRow): HTMLElement {
  const box = el('div', 'composer')
  const block = interactionBlock(row.state)
  if (block) {
    box.append(el('div', 'dim', s(
      block === 'external' ? 'typeBlockedExternal'
      : block === 'not-running' ? 'typeBlockedNotRunning'
      : 'typeBlockedApproval',
    )))
    return box
  }

  const composer = composerOf(row.id)
  if (!composer.armed) {
    box.append(button(s('typeArm'), 'btn', () => {
      state.composers.set(row.id, composerReducer(composer, { type: 'arm' }))
      renderBody()
      focusComposer()
    }))
    box.append(el('div', 'dim', s('typeArmHint')))
    return box
  }

  const rowBox = el('div', 'composer-row')
  const input = el('input', 'composer-input')
  input.type = 'text'
  input.placeholder = s('promptPlaceholder')
  input.value = composer.draft
  input.disabled = !canEdit(composer)
  input.addEventListener('input', () => {
    state.composers.set(row.id, composerReducer(composerOf(row.id), { type: 'edit', draft: input.value }))
  })
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitLine(row.id)
    if (e.key === 'Escape') disarm(row.id)
  })
  const send = button(s('send'), 'btn primary', () => submitLine(row.id))
  send.disabled = !canSubmit(composer)
  rowBox.append(input, send, button(s('typeStop'), 'btn ghost', () => disarm(row.id)))
  box.append(rowBox)

  if (composer.status === 'sending') box.append(el('div', 'dim', s('typeSending')))
  if (composer.status === 'failed' && composer.error) {
    // The exact line is kept and the server's own reason is on screen: a terminal must never accept
    // a line visually and fail to deliver it in silence.
    box.append(el('div', 'composer-failed', composer.error))
  }
  return box
}

function focusComposer(): void {
  const input = document.querySelector<HTMLInputElement>('.composer-input')
  input?.focus()
}

function disarm(id: string): void {
  state.composers.set(id, composerReducer(composerOf(id), { type: 'disarm' }))
  renderBody()
}

function submitLine(id: string): void {
  const composer = composerOf(id)
  if (!canSubmit(composer)) return
  const text = composer.draft
  state.composers.set(id, composerReducer(composer, { type: 'submit' }))
  renderBody()
  post({ type: 'act', id, action: 'prompt', text })
}

function renderVerbs(row: FleetRow): HTMLElement {
  const box = el('div', 'verbs-box')
  box.append(el('div', 'section-label', s('verbsFor')))
  const verbs = el('div', 'verbs')
  for (const verb of row.verbs) {
    // `approve` is drawn above as the option list — a bare button here would be the very
    // "pick whatever is highlighted" this screen exists to avoid.
    if (verb.action === 'approve' && row.dialogOptions?.length) continue
    const b = el('button', 'btn tiny', verb.label)
    b.disabled = !verb.enabled
    // Present and disabled, never removed: a row that drops from nine verbs to four reads as a
    // broken feature, and absence says nothing about why.
    if (verb.reason) b.title = verb.reason
    b.addEventListener('click', () => {
      if (TEXT_VERBS.has(verb.action)) openTextVerb(box, row, verb.action as FleetActionId, verb.label)
      else act(row.id, verb.action as FleetActionId)
    })
    verbs.append(b)
  }
  box.append(verbs)
  return box
}

/** The four verbs that need a line of text. Inline, because a modal over a 300px panel is a wall. */
function openTextVerb(host: HTMLElement, row: FleetRow, action: FleetActionId, label: string): void {
  host.querySelector('.text-verb')?.remove()
  const box = el('div', 'text-verb')
  const input = el('input')
  input.type = 'text'
  input.placeholder = label
  input.value = action === 'rename' ? row.title
    : action === 'note' ? row.note ?? ''
    : action === 'task' ? row.task ?? ''
    : ''
  const submit = () => {
    act(row.id, action, input.value)
    box.remove()
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') box.remove()
  })
  box.append(input, button(s('send'), 'btn small primary', submit),
    button(s('cancel'), 'btn small ghost', () => box.remove()))
  host.append(box)
  input.focus()
  input.select()
}

function act(id: string, action: FleetActionId, text?: string, choice?: number): void {
  state.busy.add(id)
  renderBody()
  post({
    type: 'act', id, action,
    ...(text !== undefined ? { text } : {}),
    ...(choice !== undefined ? { choice } : {}),
  })
}

// ---------------------------------------------------------------------------
// the wizard

const draft: SpawnRequest = { harness: '', cwd: '' }

function renderWizard(): HTMLElement {
  const box = el('div', 'wizard')
  box.append(el('div', 'wizard-title', s('wizardTitle')))

  const options = state.options
  if (!options) {
    box.append(el('p', 'dim', s('loading')))
    return box
  }
  if (options.unavailable || options.harnesses.length === 0) {
    box.append(el('p', 'notice', options.unavailable ?? s('wizardNoHarness')))
    return box
  }

  // A harness with no spawn spec is ABSENT from this list, never offered and failing — the server
  // derives it from the specs for exactly that reason.
  const harnessRow = el('div', 'field')
  harnessRow.append(el('label', undefined, s('wizardHarness')))
  const chips = el('div', 'chips')
  for (const harness of options.harnesses) {
    chips.append(button(harness.label, draft.harness === harness.id ? 'chip harness on' : 'chip harness', () => {
      draft.harness = harness.id
      draft.effort = undefined
      renderBody()
    }))
  }
  harnessRow.append(chips)
  box.append(harnessRow)

  const picked = options.harnesses.find(h => h.id === draft.harness)

  const whereRow = el('div', 'field')
  whereRow.append(el('label', undefined, s('wizardWhere')))
  const where = el('input')
  where.type = 'text'
  where.placeholder = s('wizardWherePlaceholder')
  where.value = draft.cwd
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  where.addEventListener('input', () => {
    draft.cwd = where.value
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => post({ type: 'newOptions', query: where.value }), 200)
  })
  whereRow.append(where)
  const places = el('div', 'places')
  for (const project of options.projects.slice(0, 8)) {
    const item = el('button', 'place')
    item.append(el('span', 'place-name', project.label))
    if (project.repo) item.append(el('span', 'place-repo', project.repo))
    item.append(el('span', 'place-detail', project.detail))
    item.addEventListener('click', () => {
      draft.cwd = project.path
      renderBody()
    })
    places.append(item)
  }
  whereRow.append(places)
  box.append(whereRow)

  box.append(textField(s('wizardLabel'), draft.label ?? '', v => { draft.label = v }))
  box.append(textField(s('wizardTask'), draft.task ?? '', v => { draft.task = v }, s('wizardTaskPlaceholder'), state.tasks))
  box.append(textField(s('wizardPrompt'), draft.prompt ?? '', v => { draft.prompt = v }))

  if (picked) {
    // Suggestions to OFFER and never a validation list: `claude --help` documents --model as an
    // alias "or a model's full name", so the field is typed as well as picked.
    if (picked.supportsModel) {
      box.append(textField(s('wizardModel'), draft.model ?? '', v => { draft.model = v }, '', picked.modelSuggestions))
    } else {
      box.append(el('p', 'dim', s('wizardModelNone')))
    }
    // …whereas effort IS a closed enum the CLI itself prints, so it is a picker.
    if (picked.efforts.length > 0) {
      const effortRow = el('div', 'field')
      effortRow.append(el('label', undefined, s('wizardEffort')))
      const effortChips = el('div', 'chips')
      effortChips.append(button(s('wizardEffortDefault'), draft.effort ? 'chip' : 'chip on', () => {
        draft.effort = undefined
        renderBody()
      }))
      for (const effort of picked.efforts) {
        effortChips.append(button(effort, draft.effort === effort ? 'chip on' : 'chip', () => {
          draft.effort = effort
          renderBody()
        }))
      }
      effortRow.append(effortChips)
      box.append(effortRow)
    }
  }

  const buttons = el('div', 'wizard-buttons')
  const ready = Boolean(draft.harness && draft.cwd.trim())
  const start = button(s('start'), 'btn primary', () => spawn(false))
  const startAttach = button(s('startAndAttach'), 'btn', () => spawn(true))
  start.disabled = !ready
  startAttach.disabled = !ready
  if (!ready) {
    start.title = s('wizardPickWhere')
    startAttach.title = s('wizardPickWhere')
  }
  buttons.append(start, startAttach, button(s('cancel'), 'btn ghost', () => {
    state.wizard = false
    renderBody()
  }))
  box.append(buttons)
  return box
}

function spawn(attach: boolean): void {
  post({
    type: 'spawn',
    attach,
    request: {
      harness: draft.harness,
      cwd: draft.cwd.trim(),
      ...(draft.task ? { task: draft.task } : {}),
      ...(draft.prompt ? { prompt: draft.prompt } : {}),
      ...(draft.model ? { model: draft.model } : {}),
      ...(draft.effort ? { effort: draft.effort } : {}),
      ...(draft.label ? { label: draft.label } : {}),
    },
  })
  state.wizard = false
  renderBody()
}

function textField(
  label: string,
  value: string,
  onChange: (v: string) => void,
  placeholder = '',
  suggestions: string[] = [],
): HTMLElement {
  const row = el('div', 'field')
  row.append(el('label', undefined, label))
  const input = el('input')
  input.type = 'text'
  input.value = value
  input.placeholder = placeholder
  input.addEventListener('input', () => onChange(input.value))
  row.append(input)
  if (suggestions.length > 0) {
    const chips = el('div', 'chips')
    for (const suggestion of suggestions.slice(0, 6)) {
      chips.append(button(suggestion, 'chip', () => {
        input.value = suggestion
        onChange(suggestion)
      }))
    }
    row.append(chips)
  }
  return row
}

// ---------------------------------------------------------------------------
// the channel

window.addEventListener('message', event => {
  const msg = event.data as HostMessage
  if (msg.type === 'mount') {
    state.pinned = msg.pinned
    state.theme = msg.theme
    document.body.dataset.theme = msg.theme
    go(msg.route)
    return
  }
  if (msg.type === 'theme') {
    state.theme = msg.theme
    document.body.dataset.theme = msg.theme
    render()
    return
  }
  if (msg.type === 'state') {
    state.link = msg.link
    state.rows = msg.fleet.sessions
    state.attention = msg.fleet.attention
    state.unavailable = msg.fleet.unavailable
    state.tasks = msg.fleet.tasks
    state.strings = msg.strings
    state.lang = msg.lang
    state.busy.clear()
    render()
    return
  }
  if (msg.type === 'newOptions') {
    state.options = msg.options
    renderBody()
    return
  }
  if (msg.type === 'result') {
    state.result = { ok: msg.ok, message: msg.message }
    // A result only means something to a composer that is mid-send; the reducer enforces that, so
    // handing every result to the open session's composer is safe and is what keeps a failed line
    // on screen with the server's own reason.
    if (state.route.view === 'session') {
      const id = state.route.id
      state.composers.set(id, composerReducer(composerOf(id), { type: 'sent', ok: msg.ok, message: msg.message }))
    }
    render()
    return
  }
  if (msg.type === 'busy') {
    if (msg.busy) state.busy.add(msg.id)
    else state.busy.delete(msg.id)
    renderBody()
    return
  }
  if (msg.type === 'openWizard') {
    state.wizard = true
    if (msg.cwd) draft.cwd = msg.cwd
    post({ type: 'newOptions', query: msg.cwd ?? '' })
    go({ view: 'list' })
    return
  }
  if (msg.type === 'terminal') {
    applyTerminal(msg.id, msg.event, msg.data)
    return
  }
})

function applyTerminal(id: string, event: string, data: string): void {
  const before = terminalOf(id)
  let next = before
  if (event === 'open') {
    const open = parseOpen(data)
    if (open) next = terminalReducer(before, { type: 'open', open })
  } else if (event === 'frame') {
    const frame = parseFrame(data)
    if (frame) next = terminalReducer(before, { type: 'frame', frame })
  } else if (event === 'end') {
    next = terminalReducer(before, { type: 'end', reason: parseEnd(data) ?? 'error' })
  } else {
    // A stall or a refusal before the stream opened. The reducer honours it only while frame-less,
    // so a live screen is never blanked by a blip.
    next = terminalReducer(before, { type: 'stall' })
  }
  state.terminals.set(id, next)
  if (state.route.view === 'session' && state.route.id === id) {
    // Follow the tail only if the reader was already at it — yanking someone back to the bottom
    // while they are reading further up is the single most annoying thing a live log can do.
    screenWasAtBottom = !screenEl
      || screenEl.scrollTop + screenEl.clientHeight >= screenEl.scrollHeight - TAIL_SLACK
    renderBody()
    if (screenWasAtBottom && screenEl) screenEl.scrollTop = screenEl.scrollHeight
  }
}

mount()
// Nothing is LABELLED before the host answers: `strings` arrives with the first `state` message, and
// rendering the chrome now would print the key names on screen for as long as that round trip takes.
body.append(el('div', 'empty', '…'))
post({ type: 'ready' })
