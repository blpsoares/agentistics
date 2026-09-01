/**
 * main.ts — the Sessions webview.
 *
 * Built with DOM calls and never with `innerHTML`. Every string on this screen is somebody's
 * session title, note, project path or a line captured off a terminal, and a template literal is
 * one unescaped `<` away from executing it. `textContent` cannot be got wrong.
 *
 * It renders and reports intents. It decides nothing: which verbs a row may take, what each is
 * called, why one is off and what a refused action means all arrive already decided from the
 * server, which resolves them through the same `sessionActions` the terminal cockpit resolves every
 * keypress against.
 *
 * The skeleton is built ONCE and only the parts that changed are re-rendered. A full rebuild every
 * five seconds would take the focus out of the search field mid-word and close whatever row was
 * open — the two things a person is doing when they are looking at this panel at all.
 */

import { buildView, type FleetView } from '../view-model'
import { fill } from '../i18n'
import {
  TEXT_VERBS,
  type FleetActionId, type FleetRow, type HostMessage, type LinkStatus,
  type NewOptions, type SpawnRequest, type ViewMessage,
} from '../protocol'

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

interface State {
  query: string
  onlyActive: boolean
  /** The row whose verbs are open. One at a time: this panel is often 300px wide. */
  expanded: string | null
  wizard: boolean
  busy: Set<string>
  strings: Record<string, string>
  link: LinkStatus
  rows: FleetRow[]
  attention: number
  unavailable?: string
  tasks: string[]
  options: NewOptions | null
  /** The last thing the server said about an action, shown until the next one. */
  result?: { ok: boolean; message: string }
}

const restored = (vscode.getState() as Persisted | undefined) ?? { query: '', onlyActive: false }

const state: State = {
  query: restored.query ?? '',
  onlyActive: restored.onlyActive ?? false,
  expanded: null,
  wizard: false,
  busy: new Set(),
  strings: {},
  link: { state: 'down', url: '' },
  rows: [],
  attention: 0,
  tasks: [],
  options: null,
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

// ---------------------------------------------------------------------------
// the skeleton — built once

const root = document.getElementById('root')!

const header = el('div', 'header')
const searchInput = el('input', 'search')
searchInput.type = 'search'
searchInput.value = state.query
const activeToggle = el('button', 'toggle')
const newButton = el('button', 'primary')
const refreshButton = el('button', 'ghost')
const dashboardButton = el('button', 'ghost')
const attentionPill = el('div', 'attention')

const banner = el('div', 'banner')
const wizardHost = el('div', 'wizard-host')
const resultLine = el('div', 'result')
const list = el('div', 'list')

function mount(): void {
  const bar = el('div', 'bar')
  bar.append(newButton, refreshButton, dashboardButton)
  const filters = el('div', 'filters')
  filters.append(searchInput, activeToggle)
  header.append(bar, attentionPill, filters)
  root.append(header, banner, wizardHost, resultLine, list)

  searchInput.addEventListener('input', () => {
    state.query = searchInput.value
    persist()
    renderList()
  })
  activeToggle.addEventListener('click', () => {
    state.onlyActive = !state.onlyActive
    persist()
    renderChrome()
    renderList()
  })
  refreshButton.addEventListener('click', () => post({ type: 'refresh' }))
  dashboardButton.addEventListener('click', () => post({ type: 'openDashboard' }))
  newButton.addEventListener('click', () => {
    state.wizard = !state.wizard
    if (state.wizard) post({ type: 'newOptions', query: '' })
    renderWizard()
  })
}

// ---------------------------------------------------------------------------
// chrome

function renderChrome(): void {
  searchInput.placeholder = s('searchPlaceholder')
  activeToggle.textContent = s('onlyActive')
  activeToggle.classList.toggle('on', state.onlyActive)
  activeToggle.setAttribute('aria-pressed', String(state.onlyActive))
  newButton.textContent = s('newSession')
  refreshButton.textContent = s('refresh')
  dashboardButton.textContent = s('dashboard')

  attentionPill.textContent = state.attention === 0
    ? ''
    : state.attention === 1 ? s('attentionOne') : fill(s('attentionMany'), state.attention)
  attentionPill.classList.toggle('visible', state.attention > 0)

  banner.replaceChildren()
  // Three link states, three sentences. "Nobody answered" and "answered, and said no" send a
  // person to different places, so they are never collapsed into one message.
  if (state.link.state === 'down') {
    banner.classList.add('visible')
    banner.append(el('span', undefined, fill(s('linkDown'), state.link.url)))
    const start = el('button', 'link', s('linkDownAction'))
    start.addEventListener('click', () => post({ type: 'startServer' }))
    banner.append(start)
  } else if (state.link.state === 'refused') {
    banner.classList.add('visible')
    banner.append(el('span', undefined, state.link.detail ?? s('linkRefused')))
  } else {
    banner.classList.remove('visible')
  }

  resultLine.replaceChildren()
  resultLine.classList.toggle('visible', Boolean(state.result))
  resultLine.classList.toggle('bad', state.result?.ok === false)
  if (state.result) resultLine.textContent = state.result.message
}

// ---------------------------------------------------------------------------
// the fleet

function renderList(): void {
  const view = buildView(state.rows, { query: state.query, onlyActive: state.onlyActive })
  list.replaceChildren()

  if (state.unavailable) {
    // The list may not be the whole truth, and the server said why. Shown ABOVE the rows rather
    // than instead of them: a partial answer is still an answer.
    list.append(el('div', 'notice', state.unavailable))
  }

  if (view.empty) {
    list.append(emptyState(view))
    return
  }

  for (const group of view.groups) {
    const heading = el('div', 'group', group.project || '—')
    const count = el('span', 'count', String(group.rows.length))
    heading.append(count)
    list.append(heading)
    for (const row of group.rows) list.append(renderRow(row))
  }
}

function emptyState(view: FleetView): HTMLElement {
  const box = el('div', 'empty')
  if (view.empty === 'none') {
    box.append(el('p', undefined, s('emptyNone')), el('p', 'dim', s('emptyNoneHint')))
  } else if (view.empty === 'onlyActive') {
    // Naming the switch that is hiding them, and offering to lift it: the rows are still there and
    // still reopenable, and an empty list that does not say which control emptied it reads as a
    // fleet that has vanished.
    box.append(el('p', undefined, s('emptyOnlyActive')), el('p', 'dim', s('emptyOnlyActiveHint')))
    const button = el('button', 'link', s('emptyOnlyActiveAction'))
    button.addEventListener('click', () => {
      state.onlyActive = false
      persist()
      renderChrome()
      renderList()
    })
    box.append(button)
  } else {
    box.append(el('p', undefined, fill(s('emptyFiltered'), state.query.trim())))
  }
  return box
}

function renderRow(row: FleetRow): HTMLElement {
  const card = el('div', `row state-${row.state}`)
  if (state.busy.has(row.id)) card.classList.add('busy')

  const head = el('button', 'row-head')
  head.setAttribute('aria-expanded', String(state.expanded === row.id))
  head.addEventListener('click', () => {
    state.expanded = state.expanded === row.id ? null : row.id
    renderList()
  })

  // The dot costs nothing on a fleet where nothing is waiting, and never carries the message
  // alone — the state word is beside it.
  const dot = el('span', 'dot')
  dot.textContent = row.state === 'waiting' || row.state === 'waiting-approval' ? '●' : '○'
  const title = el('span', 'title', row.title)
  const stateWord = el('span', 'state', row.stateLabel)
  head.append(dot, title, stateWord)
  card.append(head)

  const meta = el('div', 'meta')
  meta.append(el('span', 'harness', row.harness))
  if (row.model) meta.append(el('span', 'chip', row.model))
  if (row.task) meta.append(el('span', 'chip task', row.task))
  meta.append(el('span', 'cwd', row.cwd))
  card.append(meta)
  if (row.note) card.append(el('div', 'note', row.note))
  if (!row.actionable) card.append(el('div', 'dim', s('externalNote')))

  if (state.expanded === row.id) card.append(renderDetail(row))
  return card
}

function renderDetail(row: FleetRow): HTMLElement {
  const box = el('div', 'detail')

  // The dialog, verbatim, with the options READ OFF THE SCREEN by the server. They are listed and
  // the picked one is sent — a single "approve" would take whichever row happens to be
  // highlighted, which on "only my fix / promote everything / stop here" is choosing for someone.
  if (row.approvalLines?.length) {
    box.append(el('div', 'label', s('approvalTitle')))
    const pre = el('pre', 'dialog')
    pre.textContent = row.approvalLines.join('\n')
    box.append(pre)
  }
  if (row.dialogOptions?.length) {
    const options = el('div', 'options')
    for (const option of row.dialogOptions) {
      const button = el('button', option.selected ? 'option selected' : 'option', `${option.number}. ${option.label}`)
      button.addEventListener('click', () => act(row.id, 'approve', undefined, option.number))
      options.append(button)
    }
    box.append(el('div', 'label', s('chooseOption')), options)
  }

  // Attach is the one verb the server refuses to perform and hands over instead: it needs a real
  // tty, and this window has one — an integrated terminal running the very argv the cockpit runs.
  const actions = el('div', 'verbs')
  if (row.actionable) {
    const attach = el('button', 'verb primary', s('attach'))
    attach.addEventListener('click', () => post({ type: 'attach', id: row.id }))
    actions.append(attach)
  }
  const copy = el('button', 'verb ghost', s('copyCommand'))
  copy.addEventListener('click', () => post({ type: 'copy', text: row.attachCommand }))
  actions.append(copy)
  const open = el('button', 'verb ghost', s('openFolder'))
  open.addEventListener('click', () => post({ type: 'openFolder', path: row.cwd }))
  actions.append(open)

  for (const verb of row.verbs) {
    // `approve` is drawn above as the option list — a bare button here would be the very
    // "pick whatever is highlighted" this screen exists to avoid.
    if (verb.action === 'approve' && row.dialogOptions?.length) continue
    const button = el('button', 'verb', verb.label)
    button.disabled = !verb.enabled
    // Present and disabled, never removed: a row that drops from nine verbs to four reads as a
    // broken feature, and absence says nothing about why.
    if (verb.reason) button.title = verb.reason
    button.addEventListener('click', () => {
      if (TEXT_VERBS.has(verb.action)) openTextVerb(box, row, verb.action as FleetActionId, verb.label)
      else act(row.id, verb.action as FleetActionId)
    })
    actions.append(button)
  }
  box.append(el('div', 'label', s('verbsFor')), actions)
  return box
}

/** The four verbs that need a line of text. Inline, because a modal over a 300px panel is a wall. */
function openTextVerb(host: HTMLElement, row: FleetRow, action: FleetActionId, label: string): void {
  host.querySelector('.text-verb')?.remove()

  const box = el('div', 'text-verb')
  const input = el('input')
  input.type = 'text'
  input.placeholder = action === 'prompt' ? s('promptPlaceholder') : label
  input.value = action === 'rename' ? row.title : action === 'note' ? row.note ?? '' : action === 'task' ? row.task ?? '' : ''
  const send = el('button', 'primary', s('send'))
  const cancel = el('button', 'ghost', s('cancel'))
  const submit = () => {
    act(row.id, action, input.value)
    box.remove()
  }
  send.addEventListener('click', submit)
  cancel.addEventListener('click', () => box.remove())
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') box.remove()
  })
  box.append(input, send, cancel)
  host.append(box)
  input.focus()
  input.select()
}

function act(id: string, action: FleetActionId, text?: string, choice?: number): void {
  state.busy.add(id)
  renderList()
  post({ type: 'act', id, action, ...(text !== undefined ? { text } : {}), ...(choice !== undefined ? { choice } : {}) })
}

// ---------------------------------------------------------------------------
// the wizard

const draft: SpawnRequest & { attach: boolean } = {
  harness: '',
  cwd: '',
  attach: false,
}

function renderWizard(): void {
  wizardHost.replaceChildren()
  if (!state.wizard) return

  const box = el('div', 'wizard')
  box.append(el('div', 'wizard-title', s('wizardTitle')))

  const options = state.options
  if (!options) {
    box.append(el('p', 'dim', s('loading')))
    wizardHost.append(box)
    return
  }
  if (options.unavailable || options.harnesses.length === 0) {
    box.append(el('p', 'notice', options.unavailable ?? s('wizardNoHarness')))
    wizardHost.append(box)
    return
  }

  // A harness with no spawn spec is ABSENT from this list, never offered and failing — the server
  // derives it from the specs for exactly that reason.
  const harnessRow = el('div', 'field')
  harnessRow.append(el('label', undefined, s('wizardHarness')))
  const harnessPicker = el('div', 'chips')
  for (const harness of options.harnesses) {
    const chip = el('button', draft.harness === harness.id ? 'chip on' : 'chip', harness.label)
    chip.addEventListener('click', () => {
      draft.harness = harness.id
      draft.effort = undefined
      renderWizard()
    })
    harnessPicker.append(chip)
  }
  harnessRow.append(harnessPicker)
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
      renderWizard()
    })
    places.append(item)
  }
  whereRow.append(places)
  box.append(whereRow)

  box.append(textField(s('wizardLabel'), draft.label ?? '', v => { draft.label = v }))
  box.append(textField(s('wizardTask'), draft.task ?? '', v => { draft.task = v }, s('wizardTaskPlaceholder'), options.tasks))
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
      const chips = el('div', 'chips')
      const none = el('button', draft.effort ? 'chip' : 'chip on', s('wizardEffortDefault'))
      none.addEventListener('click', () => { draft.effort = undefined; renderWizard() })
      chips.append(none)
      for (const effort of picked.efforts) {
        const chip = el('button', draft.effort === effort ? 'chip on' : 'chip', effort)
        chip.addEventListener('click', () => { draft.effort = effort; renderWizard() })
        chips.append(chip)
      }
      effortRow.append(chips)
      box.append(effortRow)
    }
  }

  const buttons = el('div', 'wizard-buttons')
  const start = el('button', 'primary', s('start'))
  const startAttach = el('button', 'primary', s('startAndAttach'))
  const cancel = el('button', 'ghost', s('cancel'))
  const ready = Boolean(draft.harness && draft.cwd.trim())
  start.disabled = !ready
  startAttach.disabled = !ready
  if (!ready) {
    start.title = s('wizardPickWhere')
    startAttach.title = s('wizardPickWhere')
  }
  start.addEventListener('click', () => spawn(false))
  startAttach.addEventListener('click', () => spawn(true))
  cancel.addEventListener('click', () => { state.wizard = false; renderWizard() })
  buttons.append(start, startAttach, cancel)
  box.append(buttons)
  wizardHost.append(box)
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
  renderWizard()
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
      const chip = el('button', 'chip', suggestion)
      chip.addEventListener('click', () => {
        input.value = suggestion
        onChange(suggestion)
      })
      chips.append(chip)
    }
    row.append(chips)
  }
  return row
}

// ---------------------------------------------------------------------------
// the channel

window.addEventListener('message', event => {
  const msg = event.data as HostMessage
  if (msg.type === 'state') {
    state.link = msg.link
    state.rows = msg.fleet.sessions
    state.attention = msg.fleet.attention
    state.unavailable = msg.fleet.unavailable
    state.tasks = msg.fleet.tasks
    state.strings = msg.strings
    state.busy.clear()
    renderChrome()
    renderList()
    if (state.wizard) renderWizard()
  } else if (msg.type === 'newOptions') {
    state.options = msg.options
    renderWizard()
  } else if (msg.type === 'result') {
    state.result = { ok: msg.ok, message: msg.message }
    renderChrome()
  } else if (msg.type === 'busy') {
    if (msg.busy) state.busy.add(msg.id)
    else state.busy.delete(msg.id)
    renderList()
  } else if (msg.type === 'openWizard') {
    state.wizard = true
    if (msg.cwd) draft.cwd = msg.cwd
    post({ type: 'newOptions', query: msg.cwd ?? '' })
    renderWizard()
  }
})

mount()
// Nothing is LABELLED before the host answers: `strings` arrives with the first `state` message,
// and rendering the chrome now would print `searchPlaceholder` and `onlyActive` — the key names —
// on screen for as long as that round trip takes. A blank control for one frame is not a control
// that lies about what it does.
list.append(el('div', 'empty', '…'))
post({ type: 'ready' })
