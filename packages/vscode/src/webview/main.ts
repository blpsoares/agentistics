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
import { interactionBlock } from '../../../web/src/lib/terminalInput'

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

/**
 * How the panel opens on a surface that has never chosen.
 *
 * ONLY ACTIVE, which is `DEFAULT_SESSION_VIEW` in the control center — stated there once so every
 * surface opens the same way. It is strict on purpose: a machine with months of named work shows
 * all of it otherwise, and the empty state says which switch is hiding the rest.
 */
const DEFAULT_VIEW: Persisted = { query: '', onlyActive: true }

const restored = (vscode.getState() as Persisted | undefined) ?? DEFAULT_VIEW

const state = {
  route: { view: 'list' } as Route,
  pinned: false,
  theme: 'dark' as 'dark' | 'light',
  query: restored.query ?? '',
  onlyActive: restored.onlyActive ?? DEFAULT_VIEW.onlyActive,
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
  /** Per session, so walking away and back does not lose a screen. */
  terminals: new Map<string, TerminalState>(),
  /** True once the screen has the keyboard — see `renderScreen`. */
  typing: false,
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

  // Back goes on the LEFT, before everything, where every application in the world puts it —
  // including the editor this panel lives in. On the right it sits among the actions, reading as
  // one more of them rather than as the way out.
  if (state.route.view === 'session' && !state.pinned) {
    // Orange, not a ghost. It is the only way out of this view and it was a grey arrow among grey
    // chrome — the one control that must be findable without looking for it.
    const back = button('←', 'btn primary back', () => go({ view: 'list' }))
    back.title = s('backToList')
    back.setAttribute('aria-label', s('backToList'))
    top.append(back)
  }
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

/**
 * The session DOM, kept ALIVE between renders.
 *
 * This is not an optimisation. The fleet polls every 5s and a frame arrives up to twice a second,
 * and each render used to rebuild the whole body — which REPLACES the screen element. Replacing a
 * focused element takes the keyboard with it, so typing died half a second after it started and the
 * panel felt broken rather than slow. The screen is therefore built once per session and only its
 * contents are patched; everything around it is re-rendered into boxes that are never the focus.
 */
interface SessionDom {
  id: string
  root: HTMLElement
  head: HTMLElement
  tools: HTMLElement
  approval: HTMLElement
  screenBox: HTMLElement
  pre: HTMLPreElement
  status: HTMLElement
  strip: HTMLElement
}

let sessionDom: SessionDom | null = null

function renderBody(): void {
  if (state.route.view === 'session') {
    const id = state.route.id
    // Only rebuild when the session CHANGED or the body is showing something else. Otherwise patch,
    // and never touch the element that holds the keyboard.
    if (!sessionDom || sessionDom.id !== id || sessionDom.root.parentElement !== body) {
      sessionDom = null
      body.replaceChildren()
      body.append(buildSession(id))
    } else {
      patchSession(id)
    }
    return
  }
  sessionDom = null
  body.replaceChildren()
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

/** Build the session view once. Everything that changes later is patched in place. */
function buildSession(id: string): HTMLElement {
  const root = el('div', 'session')
  const row = rowOf(id)
  if (!row) {
    // The fleet no longer carries this id. Said in words, with the way back — a blank pane would
    // read as a broken panel rather than as a session that ended.
    root.append(el('div', 'notice', s('sessionGone')))
    if (!state.pinned) root.append(button(s('backToList'), 'btn', () => go({ view: 'list' })))
    return root
  }

  const head = el('div', 'session-head')
  const tools = el('div', 'session-tools')
  const approval = el('div', 'approval-slot')
  const { screenBox, pre, status, strip } = buildScreen(row)
  // The action row goes UNDER the screen: the terminal is why anybody opened this, and controls
  // above it push it down the panel.
  root.append(head, approval, screenBox, tools)

  sessionDom = { id, root, head, tools, approval, screenBox, pre, status, strip }
  patchSession(id)
  return root
}

/** Everything that can change while the screen keeps the keyboard. */
function patchSession(id: string): void {
  const dom = sessionDom
  const row = rowOf(id)
  if (!dom || !row) return

  // The TITLE is the heading of the screen below it, with the pencil that renames it right there.
  // It was a line of text among four other lines and a row of wide buttons — in a 320px sidebar
  // that is a wall, and the one thing a person needs to read (which session is this?) had no more
  // weight than the path under it.
  dom.head.replaceChildren()
  const title = el('div', 'session-title')
  title.append(stateDot(row))
  title.append(el('h2', 'session-name', row.title))
  title.append(iconButton('✎', s('rename'), 'icon-btn', () => {
    openTextVerb(dom.head, row, 'rename', s('rename'), row.title)
  }))
  title.append(statePill(row))
  dom.head.append(title)

  // One line of facts, not four. The harness, the model and the folder are context; the folder is
  // the long one, so it goes last and is allowed to wrap.
  const meta = el('div', 'session-meta')
  meta.append(harnessChip(row.harness))
  if (row.model) meta.append(el('span', 'chip', row.model))
  meta.append(el('span', 'session-cwd', row.cwd))
  dom.head.append(meta)

  // NOTE and TASK are shown as what they are — a value, or an invitation to add one. The `＋`
  // is the whole affordance: an icon on its own says "there is a note here" and says nothing about
  // being able to write one.
  const marks = el('div', 'session-marks')
  marks.append(markButton('✎', 'note', row.note, s('note'), () => {
    openTextVerb(dom.head, row, 'note', s('note'), row.note ?? '')
  }))
  marks.append(markButton('⚑', 'task', row.task, s('task'), () => {
    openTextVerb(dom.head, row, 'task', s('task'), row.task ?? '')
  }))
  dom.head.append(marks)

  dom.approval.replaceChildren()
  if (row.approvalLines?.length || row.dialogOptions?.length) dom.approval.append(renderApproval(row))

  paintScreen(row)

  // The action row lives UNDER the screen, as icons: in a sidebar four wide buttons wrapped into
  // three rows and pushed the terminal off the bottom. Every one carries a tooltip and an
  // aria-label, because an icon alone is a control you have to learn by clicking.
  // ONE action row, under the screen. There used to be a second, wider one below it listing every
  // verb by name — and after the title got its pencil and the marks got their `＋`, half of that
  // row was the same thing said twice: Rename, Note, Task and Stop session all had a control
  // already. Two ways to do one thing is two places to look and one of them is always the wrong
  // guess. What is left here is every verb that has no other home.
  dom.tools.replaceChildren()
  if (!state.pinned) {
    dom.tools.append(iconButton('⧉', s('openTab'), 'icon-btn', () => post({ type: 'openTab', id })))
  }
  if (row.actionable) {
    dom.tools.append(iconButton('⌨', s('attach'), 'icon-btn', () => post({ type: 'attach', id })))
  }
  dom.tools.append(iconButton('⎘', s('copyCommand'), 'icon-btn', () => post({ type: 'copy', text: row.attachCommand })))
  dom.tools.append(iconButton('🗀', s('openFolder'), 'icon-btn', () => post({ type: 'openFolder', path: row.cwd })))

  // The task verbs, and reopen. `approve` is the option list above, `prompt` is typing into the
  // screen, and the other four are the title's pencil and the two marks — so none of them appear
  // here. A verb the server sent that this panel has no home for would be silently missing, so the
  // set is explicit rather than "whatever is left".
  for (const [action, glyph] of TOOL_VERBS) {
    const verb = row.verbs.find(v => v.action === action)
    if (!verb) continue
    const b = iconButton(glyph, verb.label, 'icon-btn', () => act(id, action))
    b.disabled = !verb.enabled
    // Present and disabled with its reason, never removed: a control that vanishes says nothing
    // about why.
    if (verb.reason) b.title = `${verb.label} — ${verb.reason}`
    dom.tools.append(b)
  }

  const kill = row.verbs.find(v => v.action === 'kill')
  if (kill) {
    // Red, and it ASKS. Stopping a session ends work in progress, and the one control on this
    // screen that cannot be undone should not sit among the others looking like them.
    const stop = iconButton('⏹', kill.label, 'icon-btn danger', () => {
      post({ type: 'kill', id, title: row.title })
    })
    stop.disabled = !kill.enabled
    if (kill.reason) stop.title = `${kill.label} — ${kill.reason}`
    dom.tools.append(stop)
  }
}

/**
 * The verbs that live in the action row, and the glyph each one gets.
 *
 * Everything else the server offers has a home of its own on this screen: `approve` is the option
 * list, `prompt` is typing into the terminal, `rename` is the title's pencil, `note` and `task` are
 * the marks, `kill` is the red one below.
 */
const TOOL_VERBS: readonly (readonly [FleetActionId, string])[] = [
  ['resume', '⟲'],
  ['openTask', '⧈'],
  ['finishTask', '✓'],
]

/** An icon control. The label is never only in the glyph: it is the tooltip and the accessible name. */
function iconButton(glyph: string, label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, glyph)
  b.title = label
  b.setAttribute('aria-label', label)
  b.addEventListener('click', onClick)
  return b
}

/**
 * A note or a task: the value when there is one, and `＋ <what>` when there is not.
 *
 * The empty state is the important one. An icon by itself announces that something exists; it does
 * not tell anybody they can create one, which is what "bota um + pra tentar intuir que isso cria
 * uma nota" is asking for.
 */
function markButton(
  glyph: string,
  kind: 'note' | 'task',
  value: string | undefined,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const b = el('button', value ? `mark ${kind} set` : `mark ${kind}`)
  b.append(el('span', 'mark-glyph', value ? glyph : `${glyph}＋`))
  b.append(el('span', 'mark-text', value ?? label))
  b.title = value ? `${label}: ${value}` : label
  b.setAttribute('aria-label', b.title)
  b.addEventListener('click', onClick)
  return b
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

/**
 * The screen, and — when it has the keyboard — the thing you type into.
 *
 * **Focus is the gate.** Every terminal emulator ever written works this way: click it and you are
 * typing into it, click away and you are not. It is the same explicit, per-session, revocable
 * decision the dashboard's composer asks for with a button, expressed the way a terminal expresses
 * it, and the strip under the screen SAYS which of the two states you are in — a screen that
 * silently swallows keys, or silently ignores them, is the failure either design has to avoid.
 *
 * It is an INTENT gate and nothing more. The real authority is the server: `localShell` on any
 * exposed profile, scope (only sessions this machine manages), and a session that is actually
 * running.
 */
function buildScreen(row: FleetRow): {
  screenBox: HTMLElement
  pre: HTMLPreElement
  status: HTMLElement
  strip: HTMLElement
} {
  const screenBox = el('div', 'screen-box')
  const pre = el('pre', 'screen')
  const status = el('div', 'screen-status')
  const strip = el('div', 'typing-strip')

  // Bound ONCE, to the element that lives for as long as this session is open. Re-binding on every
  // frame would mean re-creating this node, and re-creating a focused node takes the keyboard.
  pre.tabIndex = 0
  pre.addEventListener('keydown', e => onScreenKey(row.id, e))
  pre.addEventListener('paste', e => onScreenPaste(row.id, e))
  pre.addEventListener('focus', () => { state.typing = true; paintTypingStrip(row.id) })
  pre.addEventListener('blur', () => { state.typing = false; paintTypingStrip(row.id) })

  screenBox.append(pre, status, strip)
  screenEl = pre
  return { screenBox, pre, status, strip }
}

/**
 * Repaint the screen's CONTENTS — never its elements.
 *
 * The cursor is drawn only while the channel says there is one (`showCursor` is false on a dead or
 * gone pane), so a finished session never blinks as though somebody could still type into it.
 */
function paintScreen(row: FleetRow): void {
  const dom = sessionDom
  if (!dom) return
  const terminal = terminalOf(row.id)
  const status = terminalStatus(terminal, state.lang)

  // THE ONE PLACE THIS FILE ASSIGNS HTML. `ansiToHtml` escapes the frame before it colours it, and
  // returns spans and text nodes only — see its header. Nothing else here goes near innerHTML.
  dom.pre.innerHTML = terminal.frame
    ? ansiToHtml(
        terminal.frame.content,
        state.theme,
        status.showCursor ? terminal.frame.cursor : null,
      )
    : ''

  dom.status.replaceChildren()
  dom.status.append(el('span', `pill ${status.tone}`, status.label))
  dom.status.append(el('span', 'dim', status.detail))
  if (status.truncated) dom.status.append(el('span', 'dim', s('screenTruncated')))

  paintTypingStrip(row.id)
}

/**
 * The one line under the screen that says whether your keys are going anywhere.
 *
 * Re-rendered on focus and blur ALONE — not through the whole view — because a full re-render on
 * focus would replace the very element that just took it, and the keyboard would land back on the
 * document a frame later.
 */
function paintTypingStrip(id: string): void {
  const dom = sessionDom
  const row = rowOf(id)
  if (!dom || !row) return
  // The line composer refuses a session on a dialog, because a LINE typed past a question lands in
  // the dialog's own filter. Raw keys are the opposite case: answering that dialog by keypress is
  // one of the reasons this exists, and the person can see it on the screen in front of them.
  const block = interactionBlock(row.state)
  const typable = block !== 'external' && block !== 'not-running'
  const focused = state.typing && typable && document.activeElement === dom.pre
  const strip = dom.strip
  strip.replaceChildren()
  strip.className = `typing-strip${focused ? ' live' : ''}`

  if (!typable) {
    strip.append(el('span', 'dim', s(
      block === 'external' ? 'typeBlockedExternal' : 'typeBlockedNotRunning',
    )))
    return
  }
  if (focused) {
    strip.append(el('span', 'typing-dot', '●'))
    strip.append(el('span', undefined, s('typingLive')))
    strip.append(el('span', 'dim', s('typingLiveHint')))
    return
  }
  const focus = button(s('typingStart'), 'btn tiny primary', () => screenEl?.focus())
  strip.append(focus, el('span', 'dim', s('typingIdle')))
}

// ---------------------------------------------------------------------------
// typing
//
// Printable characters are BUFFERED for a few milliseconds and sent as one `text`, because one HTTP
// round trip per keystroke is ~5 requests a second per typist, each spawning a `tmux send-keys` on
// the host. A non-printable key FLUSHES the buffer first and then goes on its own, so `abc<Enter>`
// can never arrive as `<Enter>abc`. Ordering across calls is the client's serialised queue
// (`api.ts`), so nothing here has to think about it beyond flushing in order.

const TYPE_FLUSH_MS = 25
let typeBuffer = ''
let typeTimer: ReturnType<typeof setTimeout> | undefined

function flushTyping(id: string): void {
  clearTimeout(typeTimer)
  typeTimer = undefined
  if (!typeBuffer) return
  const text = typeBuffer
  typeBuffer = ''
  post({ type: 'input', id, text })
}

/**
 * Keys that are not input, whatever a keyboard reports.
 *
 * A modifier press fires its own `keydown` — holding Shift to type a capital sends `Shift` first —
 * and a laptop's media row sends things like `MediaTrackNext`. Sent to the server those are refused
 * by name, correctly, and the user gets a red banner for a key they never meant to press. The
 * server's table stays the authority on what CAN be sent; this is the client not asking about keys
 * that are not keystrokes at all.
 */
const NOT_INPUT: ReadonlySet<string> = new Set([
  'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'NumLock', 'ScrollLock',
  'ContextMenu', 'Dead', 'Unidentified', 'Process', 'Compose', 'Fn', 'FnLock', 'Hyper', 'Super',
  'Insert',
])
/** The media / launcher / browser rows, which report a whole family of names. */
const NOT_INPUT_PREFIX = ['Media', 'Launch', 'Browser', 'Audio', 'Video', 'Zoom', 'Power', 'Print']

function isInputKey(key: string): boolean {
  if (NOT_INPUT.has(key)) return false
  return !NOT_INPUT_PREFIX.some(prefix => key.startsWith(prefix))
}

function onScreenKey(id: string, e: KeyboardEvent): void {
  // The editor's own chords are left alone: `ctrl+shift+*` and anything with Cmd/Win is a VS Code
  // command, and swallowing those would make the panel a place where the editor stops working.
  if (e.metaKey || (e.ctrlKey && e.shiftKey)) return
  if (!isInputKey(e.key)) return

  const printable = e.key.length === 1 && !e.ctrlKey && !e.altKey
  e.preventDefault()
  e.stopPropagation()

  if (printable) {
    typeBuffer += e.key
    if (!typeTimer) typeTimer = setTimeout(() => flushTyping(id), TYPE_FLUSH_MS)
    return
  }
  flushTyping(id)
  post({
    type: 'input',
    id,
    key: {
      key: e.key,
      ...(e.ctrlKey ? { ctrl: true } : {}),
      ...(e.altKey ? { alt: true } : {}),
      ...(e.shiftKey ? { shift: true } : {}),
    },
  })
}

/** A paste is one `text` — the whole reason the channel takes text and not only keys. */
function onScreenPaste(id: string, e: ClipboardEvent): void {
  const text = e.clipboardData?.getData('text')
  if (!text) return
  e.preventDefault()
  flushTyping(id)
  // Newlines inside a paste are Enter presses, and Enter is a KEY. Splitting here keeps a pasted
  // block from being refused whole for carrying control characters.
  const lines = text.split(/\r\n|\r|\n/)
  lines.forEach((line, index) => {
    if (line) post({ type: 'input', id, text: line })
    if (index < lines.length - 1) post({ type: 'input', id, key: { key: 'Enter' } })
  })
}

/** The four verbs that need a line of text. Inline, because a modal over a 300px panel is a wall. */
function openTextVerb(
  host: HTMLElement,
  row: FleetRow,
  action: FleetActionId,
  label: string,
  initial?: string,
): void {
  host.querySelector('.text-verb')?.remove()
  const box = el('div', 'text-verb')
  const input = el('input')
  input.type = 'text'
  input.placeholder = label
  input.value = initial ?? (action === 'rename' ? row.title
    : action === 'note' ? row.note ?? ''
    : action === 'task' ? row.task ?? ''
    : '')
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
  if (state.route.view !== 'session' || state.route.id !== id) return
  const row = rowOf(id)
  if (!row || !sessionDom || sessionDom.id !== id) return

  // Only the screen's CONTENTS are repainted — never the element. A frame arrives up to twice a
  // second, and replacing a focused node takes the keyboard with it, which is what made typing die
  // half a second after it started.
  //
  // Follow the tail only if the reader was already at it: yanking someone back to the bottom while
  // they are reading further up is the single most annoying thing a live log can do.
  screenWasAtBottom = !screenEl
    || screenEl.scrollTop + screenEl.clientHeight >= screenEl.scrollHeight - TAIL_SLACK
  paintScreen(row)
  if (screenWasAtBottom && screenEl) screenEl.scrollTop = screenEl.scrollHeight
}

mount()
// Nothing is LABELLED before the host answers: `strings` arrives with the first `state` message, and
// rendering the chrome now would print the key names on screen for as long as that round trip takes.
body.append(el('div', 'empty', '…'))
post({ type: 'ready' })
