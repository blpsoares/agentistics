import { describe, expect, it } from 'bun:test'
import {
  attentionOf, detailLines, groupSessions, rowWidth, selectableIndexes, sessionActions, sessionCells,
  sessionRows, sortSessions, summaryCells, actionLabels, enabledActionIndexes,
  sessionColumns, sessionsCockpit, asideRows, asideSelectable, projectCounts, projectColumns,
  projectPickRows, groupProjects, asideSections, asideFold, scrollBar, THUMB, TRACK, sessionNamed,
  sessionHandle, worktreeName, sessionRunning, asideRowKey, resolveAsideCursor,
  sessionAge, sessionKeyHelp, keyHelpColumn,
  DEFAULT_ORDER, usageOf, planSubmit,
} from './sessions'
import type { ControlSession, SessionState } from './types'

const UNKNOWN = {
  harness: 'harness unknown', model: 'no model recorded', project: 'no directory', task: 'no task',
  repo: 'no repository',
}

const session = (id: string, over: Partial<ControlSession> = {}): ControlSession => ({
  id,
  title: id,
  harness: 'claude',
  cwd: `/repo/${id}`,
  project: id,
  state: 'waiting' as SessionState,
  stateLabel: 'waiting',
  actionable: true,
  attached: false,
  searchText: id,
  ...over,
})

describe('sortSessions', () => {
  it('puts what is waiting on a person above what is running', () => {
    const list = [
      session('w', { state: 'working', stateLabel: 'working' }),
      session('x', { state: 'exited', stateLabel: 'exited' }),
      session('a', { state: 'waiting-approval', stateLabel: 'needs approval' }),
      session('k'),
    ]
    expect(sortSessions(list).map(s => s.id)).toEqual(['a', 'k', 'w', 'x'])
  })

  it('puts an external session last, whatever its age', () => {
    const list = [
      session('e', { state: 'unknown', stateLabel: 'external', actionable: false, startedAt: 999 }),
      session('w', { state: 'working', stateLabel: 'working', startedAt: 1 }),
    ]
    expect(sortSessions(list).map(s => s.id)).toEqual(['w', 'e'])
  })

  it('breaks a tie on the newest', () => {
    const list = [session('old', { startedAt: 1 }), session('new', { startedAt: 2 })]
    expect(sortSessions(list).map(s => s.id)).toEqual(['new', 'old'])
  })
})

describe('attentionOf', () => {
  it('counts both waiting states and nothing else', () => {
    const list = [
      session('a', { state: 'waiting-approval' }),
      session('b', { state: 'waiting' }),
      session('c', { state: 'working' }),
      session('d', { state: 'unknown' }),
    ]
    expect(attentionOf(list)).toBe(2)
  })
})

describe('groupSessions', () => {
  const list = [
    session('a', { harness: 'claude', model: 'opus', project: 'x', state: 'working' }),
    session('b', { harness: 'codex', project: 'x', state: 'waiting-approval' }),
    session('c', { harness: 'claude', model: 'opus', project: 'y', state: 'working' }),
  ]

  it('returns one unnamed group when grouping is off', () => {
    const g = groupSessions(list, 'none', UNKNOWN)
    expect(g).toHaveLength(1)
    expect(g[0]!.label).toBe('')
    expect(g[0]!.sessions).toHaveLength(3)
  })

  it('groups by harness', () => {
    const g = groupSessions(list, 'harness', UNKNOWN)
    expect(g.map(x => x.key).sort()).toEqual(['claude', 'codex'])
  })

  it('orders groups by their most urgent member, never alphabetically first', () => {
    // The blocked session is in `codex`, which sorts after `claude` — grouping must not bury the
    // thing the screen exists to surface.
    const g = groupSessions(list, 'harness', UNKNOWN)
    expect(g[0]!.key).toBe('codex')
  })

  it('names an absent fact in that dimension own words', () => {
    const g = groupSessions(list, 'model', UNKNOWN)
    expect(g.find(x => x.key === '')!.label).toBe('no model recorded')
    const h = groupSessions([session('u', { harness: '' })], 'harness', UNKNOWN)
    expect(h[0]!.label).toBe('harness unknown')
  })
})

describe('sessionRows / selectableIndexes', () => {
  it('draws a heading per named group, with air between them', () => {
    const groups = groupSessions(
      [session('a', { harness: 'claude' }), session('b', { harness: 'codex' })],
      'harness',
      UNKNOWN,
    )
    const rows = sessionRows(groups)
    expect(rows.map(r => r.kind)).toEqual(['heading', 'session', 'spacer', 'heading', 'session'])
  })

  it('never lets the cursor land on a heading or a blank', () => {
    // The cursor moves over ONE list; counting rows and sessions separately is what makes a
    // selection and its highlight disagree at the first group boundary.
    const rows = sessionRows(groupSessions(
      [session('a', { harness: 'claude' }), session('b', { harness: 'codex' })], 'harness', UNKNOWN,
    ))
    expect(selectableIndexes(rows)).toEqual([1, 4])
    for (const i of selectableIndexes(rows)) expect(rows[i]!.kind).toBe('session')
  })

  it('draws no heading when grouping is off and nothing is closed', () => {
    const rows = sessionRows(groupSessions([session('a')], 'none', UNKNOWN))
    expect(rows.map(r => r.kind)).toEqual(['session'])
  })

  it('always gives closed conversations their own section, even with grouping off', () => {
    // A conversation that is over is not a session that is running. Putting the two in one
    // undifferentiated run made the list read as if everything on it were open.
    const rows = sessionRows(groupSessions(
      [session('live'), session('old', { state: 'closed', stateLabel: 'closed' })],
      'none',
      UNKNOWN,
    ), 'closed')
    expect(rows.map(r => r.kind)).toEqual(['session', 'spacer', 'heading', 'session'])
    const heading = rows.find(r => r.kind === 'heading')
    expect(heading).toMatchObject({ label: 'closed', count: 1, muted: true })
  })

  it('names the group a closed block belongs to, so a heading is never ambiguous', () => {
    const rows = sessionRows(groupSessions(
      [session('old', { state: 'closed', stateLabel: 'closed', task: 'billing' })],
      'task',
      UNKNOWN,
    ), 'closed')
    expect(rows.find(r => r.kind === 'heading')).toMatchObject({ label: 'billing · closed' })
  })

  it('marks an absence bucket as muted, so it does not read as a category', () => {
    const rows = sessionRows(groupSessions([session('a')], 'task', UNKNOWN), 'closed')
    expect(rows.find(r => r.kind === 'heading')).toMatchObject({ label: 'no task', muted: true })
  })
})

describe('sessionCells', () => {
  const s = session('a', { title: 'refactor auth', harness: 'claude', project: 'agentistics', stateLabel: 'waiting' })

  it('keeps every cell when the row fits', () => {
    const c = sessionCells(s, 80)
    expect(c).toEqual({ state: 'waiting', title: 'refactor auth', harness: 'claude', where: 'agentistics' })
    expect(rowWidth(c)).toBeLessThanOrEqual(80)
  })

  it('gives up the directory first', () => {
    const c = sessionCells(s, 30)
    expect(c.where).toBe('')
    expect(c.harness).toBe('claude')
    expect(c.title).toBe('refactor auth')
  })

  it('gives up the harness second', () => {
    const c = sessionCells(s, 24)
    expect(c.harness).toBe('')
    expect(c.title).toBe('refactor auth')
  })

  it('keeps the state word to the very end, truncating the title instead', () => {
    // The state is the one cell nothing else on the frame repeats. A row reduced to a coloured
    // glyph would announce "waiting for you" in colour alone.
    const c = sessionCells(s, 14)
    expect(c.state).toBe('waiting')
    expect(c.title.length).toBeGreaterThan(0)
    expect(rowWidth(c)).toBeLessThanOrEqual(14)
  })

  it('never renders wider than it was given, even absurdly narrow', () => {
    for (const w of [1, 2, 3, 5, 8, 12, 20, 40]) {
      expect(rowWidth(sessionCells(s, w))).toBeLessThanOrEqual(Math.max(w, s.stateLabel.length))
    }
  })
})

describe('detailLines', () => {
  const labels = {
    where: 'where', model: 'model', note: 'note', started: 'started',
    external: 'started outside agentop', closed: 'not running', doing: 'saying', task: 'task', metrics: 'usage',
  }
  const ago = () => '5m ago'

  it('always states where the session is', () => {
    const l = detailLines(session('a', { cwd: '/repo/a' }), labels, ago)
    expect(l[0]).toMatchObject({ label: 'where', value: '/repo/a' })
  })

  it('omits a fact that was never recorded rather than showing it empty', () => {
    const l = detailLines(session('a'), labels, ago)
    expect(l.map(x => x.key)).not.toContain('model')
    expect(l.map(x => x.key)).not.toContain('note')
    expect(l.map(x => x.key)).not.toContain('started')
  })

  it('says an external session cannot be driven from here', () => {
    const l = detailLines(session('e', { actionable: false }), labels, ago)
    expect(l.find(x => x.key === 'external')).toMatchObject({ note: true })
  })

  it('carries the approval caveat only where the host supplied one', () => {
    // An absent caveat is silence, never a reassurance — so it is present exactly when true.
    expect(detailLines(session('a'), labels, ago).map(x => x.key)).not.toContain('blind')
    const blind = detailLines(session('a', { approvalBlind: 'no markers for x' }), labels, ago)
    expect(blind.find(x => x.key === 'blind')).toMatchObject({ note: true, value: 'no markers for x' })
  })
})

describe('sessionActions', () => {
  const words = {
    attach: 'Attach', resume: 'Reopen', rename: 'Rename', note: 'Note', task: 'Task',
    kill: 'Stop', openTask: 'Open whole task', finishTask: 'Finish task',
    new: 'New', search: 'Search', group: 'Group',
  }
  const of = (s?: ControlSession) => sessionActions(s).map(a => a.action)
  const on = (s?: ControlSession) => sessionActions(s).filter(a => a.enabled).map(a => a.action)

  it('always offers the SAME set, whatever is selected', () => {
    // A menu that loses five of its nine items reads as a broken feature, not as a row that cannot
    // take them. The shape stays constant; what changes is which ones are live.
    const shape = of(session('m'))
    expect(of(undefined).length).toBe(shape.length)
    expect(of(session('e', { state: 'unknown', actionable: false })).length).toBe(shape.length)
    expect(shape).toContain('rename')
    expect(shape).toContain('kill')
  })

  it('enables only what needs no selection when nothing is selected', () => {
    expect(on(undefined)).toEqual(['new', 'search', 'group'])
  })

  it('enables attach and the metadata verbs on a session agentop runs', () => {
    const a = on(session('m'))
    expect(a).toContain('attach')
    expect(a).toContain('rename')
    expect(a).toContain('kill')
    expect(a).not.toContain('resume')
  })

  it('offers reopen in attach position on a row agentop does not run, and dims the rest', () => {
    const external = session('e', {
      state: 'unknown', actionable: false, resume: { sessionId: 's1', title: 'auth' },
    })
    expect(of(external)[0]).toBe('resume')
    expect(on(external)).toContain('resume')
    // Still PRESENT, so the menu keeps its shape — just not runnable here.
    expect(of(external)).toContain('rename')
    expect(on(external)).not.toContain('rename')
  })

  it('dims reopen too when the harness cannot reopen by id', () => {
    const external = session('e', { state: 'unknown', actionable: false })
    expect(of(external)).toContain('resume')
    expect(on(external)).toEqual(['new', 'search', 'group'])
  })

  it('enables the whole task only once the session is filed under one', () => {
    expect(on(session('m'))).not.toContain('openTask')
    expect(on(session('m', { task: 'XPTO' }))).toContain('openTask')
  })

  it('never lets the cursor land on a verb that cannot run', () => {
    const external = session('e', { state: 'unknown', actionable: false })
    const offered = sessionActions(external)
    for (const i of enabledActionIndexes(offered)) expect(offered[i]!.enabled).toBe(true)
  })

  it('labels every verb it offers, in the caller language', () => {
    for (const l of actionLabels(sessionActions(session('m', { task: 'X' })), words)) {
      expect(l.length).toBeGreaterThan(0)
    }
  })
})

describe('detailLines — the two non-actionable rows say different things', () => {
  const labels = {
    where: 'where', model: 'model', note: 'note', started: 'started',
    external: 'started outside agentop', closed: 'not running', doing: 'saying',
    task: 'task', metrics: 'usage',
  }
  const ago = () => '5m ago'

  it('says a closed conversation is not running, never that it started elsewhere', () => {
    // One sentence for both said "started outside agentop" about a conversation agentop may well
    // have started and that is simply over.
    const l = detailLines(session('c', { state: 'closed', actionable: false }), labels, ago)
    expect(l.find(x => x.key === 'closed')?.value).toBe('not running')
    expect(l.map(x => x.key)).not.toContain('external')
  })

  it('still says a foreign session started elsewhere', () => {
    const l = detailLines(session('e', { state: 'unknown', actionable: false }), labels, ago)
    expect(l.map(x => x.key)).toContain('external')
    expect(l.map(x => x.key)).not.toContain('closed')
  })

  it('leads with what the session is saying, when it is saying anything', () => {
    const l = detailLines(session('m', { lastLines: ['● done'] }), labels, ago)
    expect(l[0]).toMatchObject({ label: 'saying', value: '● done', say: true })
  })

  it('shows usage only where the conversation recorded any', () => {
    expect(detailLines(session('m'), labels, ago).map(x => x.key)).not.toContain('metrics')
    const l = detailLines(session('m', { tokens: '41.4K', cost: 'USD 0.26' }), labels, ago)
    expect(l.find(x => x.key === 'metrics')?.value).toBe('41.4K  ·  USD 0.26')
  })
})

describe('summaryCells', () => {
  const full = {
    group: 'GROUP task',
    hiding: '− closed conversations, sessions with no task',
    count: '18 sessions',
    waiting: '3 waiting on you',
    width: 200,
  }

  const rendered = (c: ReturnType<typeof summaryCells>) =>
    [c.group, c.hiding, c.count, c.waiting].filter(Boolean)
      .reduce((n, p) => n + p.length, 0)
      + 3 * Math.max(0, [c.group, c.hiding, c.count, c.waiting].filter(Boolean).length - 1)

  it('keeps everything when the row fits', () => {
    expect(summaryCells(full)).toEqual({
      group: full.group, hiding: full.hiding, count: full.count, waiting: full.waiting,
    })
  })

  it('gives up what is HIDDEN first — the panel one keypress away states it in full', () => {
    const c = summaryCells({ ...full, width: 40 })
    expect(c.hiding).toBe('')
    expect(c.group).toBe('GROUP task')
  })

  it('keeps the grouping to the very end, because it explains the arrangement', () => {
    const c = summaryCells({ ...full, width: 12 })
    expect(c.group).toContain('GROUP')
    expect(c.count).toBe('')
    expect(c.waiting).toBe('')
  })

  it('NEVER renders wider than it was given, at any width', () => {
    // The whole point. A row that wraps takes two of the screen's rows while its budget counted
    // one, which pushes the action row, the detail pane and the footer off the bottom — and that
    // reads as "the entire screen vanished", not as "one row is too wide".
    for (let w = 0; w <= 220; w++) {
      expect(rendered(summaryCells({ ...full, width: w }))).toBeLessThanOrEqual(Math.max(w, 0) || 0)
    }
  })
})

describe('sessionColumns', () => {
  const rows = [
    session('a', { stateLabel: 'needs approval', title: 'migrate the auth store', harness: 'claude', project: 'agentistics' }),
    session('b', { stateLabel: 'exited', title: 'release notes', harness: 'codex', project: 'aipe' }),
  ]
  const drawn = (c: ReturnType<typeof sessionColumns>) =>
    2 + c.state + (c.title ? 2 + c.title : 0) + (c.harness ? 2 + c.harness : 0) + (c.where ? 2 + c.where : 0)

  it('sizes every column to the widest row on screen, so the cells line up', () => {
    // Two spaces between unpadded cells started every title at a different column, because the
    // state words differ by ten characters. Nothing after them ever lined up.
    const c = sessionColumns(rows, 100)
    expect(c.state).toBe('needs approval'.length)
    expect(c.title).toBe('migrate the auth store'.length)
    expect(c.harness).toBe('claude'.length)
  })

  it('gives the title what it NEEDS, not the whole remainder', () => {
    // Stretching it to the leftover pushed the harness and the directory to the far edge with a
    // field of blank between — the old misalignment wearing a different shape.
    expect(sessionColumns(rows, 200).title).toBe('migrate the auth store'.length)
  })

  it('gives up the directory first, then the harness', () => {
    // The directory goes while the harness still fits, and the harness only once the title has
    // already been squeezed to almost nothing — the state word outlives both.
    expect(sessionColumns(rows, 46).where).toBe(0)
    expect(sessionColumns(rows, 46).harness).toBeGreaterThan(0)
    expect(sessionColumns(rows, 24).harness).toBe(0)
    expect(sessionColumns(rows, 24).state).toBe("needs approval".length)
  })

  it('never asks for more columns than it was given, at any width', () => {
    for (let w = 4; w <= 160; w++) {
      expect(drawn(sessionColumns(rows, w))).toBeLessThanOrEqual(Math.max(w, 2 + 'needs approval'.length + 3))
    }
  })

  it('draws NO usage column when nothing on screen has any', () => {
    // A fleet whose harnesses report no usage must not pay for the column, nor for the gap before
    // it — reserving a space nothing occupies narrows every title on the screen.
    expect(sessionColumns(rows, 100).metrics).toBe(0)
    expect(sessionColumns(rows, 100).title).toBe('migrate the auth store'.length)
  })

  it('sizes the usage column to the widest row that has any', () => {
    const withUse = [
      session('a', { stateLabel: 'waiting', title: 'one', tokens: '51.7k', cost: '$1.20' }),
      session('b', { stateLabel: 'waiting', title: 'two' }),
    ]
    expect(sessionColumns(withUse, 120).metrics).toBe('51.7k $1.20'.length)
  })

  it('gives up usage AFTER the directory and the harness, and never before the name', () => {
    const withUse = [
      session('a', { stateLabel: 'needs approval', title: 'migrate the auth store', tokens: '51.7k', cost: '$1.20' }),
    ]
    // The widths are MEASURED rather than guessed: the point is the ORDER cells are surrendered in,
    // and pinning it to three hand-picked numbers tests the arithmetic of this particular fixture.
    const lost = (pick: (c: ReturnType<typeof sessionColumns>) => number) => {
      for (let w = 200; w >= 4; w--) if (pick(sessionColumns(withUse, w)) === 0) return w
      return 0
    }
    const where = lost(c => c.where)
    const harness = lost(c => c.harness)
    const metrics = lost(c => c.metrics)
    // Each is given up at a NARROWER width than the one before it — the directory first, the
    // harness next, usage last.
    expect(where).toBeGreaterThan(harness)
    expect(harness).toBeGreaterThan(metrics)
    // And the state word and a usable name outlive all three.
    const bare = sessionColumns(withUse, metrics)
    expect(bare.metrics).toBe(0)
    expect(bare.state).toBe('needs approval'.length)
    expect(bare.title).toBeGreaterThan(0)
  })

  it('never asks for more columns than it was given, WITH usage, at any width', () => {
    const withUse = [
      session('a', { stateLabel: 'needs approval', title: 'migrate the auth store', tokens: '51.7k', cost: '$1.20' }),
      session('b', { stateLabel: 'exited', title: 'release notes', harness: 'codex', project: 'aipe' }),
    ]
    const wide = (c: ReturnType<typeof sessionColumns>) =>
      2 + c.state + (c.title ? 2 + c.title : 0) + (c.task ? 2 + c.task : 0)
      + (c.metrics ? 2 + c.metrics : 0)
      + (c.harness ? 2 + c.harness : 0) + (c.where ? 2 + c.where : 0)
    for (let w = 4; w <= 200; w++) {
      expect(wide(sessionColumns(withUse, w)))
        .toBeLessThanOrEqual(Math.max(w, 2 + 'needs approval'.length + 3))
    }
  })
})

describe('sessionsCockpit', () => {
  const at = (width: number, height: number, detailWanted = 4) =>
    sessionsCockpit({ width, height, asideLabel: 16, detailWanted })

  it('gives the aside its measured width and the list the rest', () => {
    const l = at(120, 30)
    // The label plus the cursor, the state dot and a trailing count — sizing to the label alone
    // truncated every long verb in the menu.
    expect(l.aside).toBe(20)
    expect(l.list).toBe(120 - 20 - 1)
  })

  it('DROPS the aside on a narrow terminal rather than squeezing the sessions', () => {
    // At forty columns an aside leaves nothing for the sessions, and the sessions are what the
    // screen is. The letters keep working, so a narrow terminal loses the menu, not the feature.
    const l = at(40, 30)
    expect(l.aside).toBe(0)
    expect(l.list).toBe(40)
  })

  it('bounds the aside so one long label cannot eat the screen', () => {
    expect(sessionsCockpit({ width: 200, height: 30, asideLabel: 90, detailWanted: 4 }).aside)
      .toBeLessThanOrEqual(34)
  })

  it('draws no detail pane when nothing is selected to describe', () => {
    const l = at(120, 30, 0)
    expect(l.detail).toBe(0)
    expect(l.band).toBe(30)
  })

  it('caps the detail pane at half the screen, however much it wants to say', () => {
    const l = at(120, 30, 100)
    expect(l.detail).toBe(15)
    expect(l.band).toBe(15)
  })

  it('never invents a row or a column, at any size', () => {
    for (let w = 1; w <= 200; w += 7) {
      for (let h = 1; h <= 60; h += 3) {
        const l = at(w, h)
        expect(l.band + l.detail).toBe(Math.max(1, h))
        expect(l.list + (l.aside > 0 ? l.aside + 1 : 0)).toBe(Math.max(1, w))
        expect(l.list).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe('asideRows', () => {
  const words = {
    attach: 'Attach', resume: 'Reopen', rename: 'Rename', note: 'Note', task: 'Task',
    kill: 'Stop', openTask: 'Open whole task', finishTask: 'Finish task',
    new: 'New', search: 'Search', group: 'Group',
  }
  const groupWords = { repo: 'repo', none: 'flat', task: 'tasks', harness: 'harness', model: 'model', project: 'project' }
  const toggleWords = { closed: 'closed', exited: 'finished', unfiled: 'no task', done: 'done tasks', active: 'only active', detail: 'detail' }
  const headings = { actions: 'ACTIONS', view: 'VIEW', show: 'SHOW' }

  const build = (o: Partial<Parameters<typeof asideRows>[0]> = {}) => asideRows({
    actions: sessionActions(session('m')),
    actionWords: words,
    grouping: 'none',
    groupWords,
    toggles: { closed: false, exited: false, unfiled: false, done: false, active: false, detail: false },
    toggleWords,
    headings,
    showUnfiled: false,
    ...o,
  })

  it('puts what you came to do above what you set once and leave', () => {
    const rows = build()
    const firstHeading = rows.findIndex(r => r.kind === 'heading')
    const firstAction = rows.findIndex(r => r.kind === 'action')
    const firstGroup = rows.findIndex(r => r.kind === 'group')
    expect(firstHeading).toBeLessThan(firstAction)
    expect(firstAction).toBeLessThan(firstGroup)
  })

  it('states every row own state, so nothing must be pressed to be discovered', () => {
    const rows = build({ grouping: 'task', toggles: { closed: true, exited: false, unfiled: false, done: false, active: false, detail: false } })
    expect(rows.find(r => r.kind === 'group' && r.value === 'task')).toMatchObject({ on: true })
    expect(rows.find(r => r.kind === 'group' && r.value === 'none')).toMatchObject({ on: false })
    expect(rows.find(r => r.kind === 'toggle' && r.toggle === 'closed')).toMatchObject({ on: true })
  })

  it('offers the unfiled switch only where it means something', () => {
    expect(build().some(r => r.kind === 'toggle' && r.toggle === 'unfiled')).toBe(false)
    expect(build({ showUnfiled: true }).some(r => r.kind === 'toggle' && r.toggle === 'unfiled')).toBe(true)
  })

  it('never lets the cursor land on a heading, a rule, or a disabled verb', () => {
    const rows = build({ actions: sessionActions(session('e', { state: 'unknown', actionable: false })) })
    for (const i of asideSelectable(rows)) {
      const r = rows[i]!
      expect(r.kind).not.toBe('heading')
      expect(r.kind).not.toBe('rule')
      if (r.kind === 'action') expect(r.enabled).toBe(true)
    }
    // The disabled verbs are still PRESENT — the menu keeps its shape.
    expect(rows.some(r => r.kind === 'action' && r.action === 'rename' && !r.enabled)).toBe(true)
  })
})

describe('finished tasks', () => {
  const fleet = [
    session('a', { task: 'ship the cockpit', title: 'a' }),
    session('b', { task: 'ship the cockpit', title: 'b' }),
    session('c', { task: 'pricing audit', title: 'c' }),
  ]
  const group = (done: string[]) =>
    groupSessions(fleet, 'task', UNKNOWN, done)

  it('marks only the task the user finished, and only while grouping by task', () => {
    const g = group(['ship the cockpit'])
    expect(g.find(x => x.key === 'ship the cockpit')?.done).toBe(true)
    expect(g.find(x => x.key === 'pricing audit')?.done).toBeUndefined()
    // The same names mean nothing on another dimension: a PROJECT called after a finished task is
    // not a finished project.
    const byProject = groupSessions(fleet, 'project', UNKNOWN, ['a'])
    expect(byProject.every(x => x.done === undefined)).toBe(true)
  })

  it('says so in the heading and mutes it, rather than only dimming the rows', () => {
    const rows = sessionRows(group(['ship the cockpit']), 'closed', 'finished')
    const head = rows.find(r => r.kind === 'heading' && r.label.startsWith('ship the cockpit'))
    expect(head).toBeDefined()
    expect((head as { label: string }).label).toBe('ship the cockpit · finished')
    expect((head as { muted?: boolean }).muted).toBe(true)
  })

  it('leaves the heading alone when the caller has no word for it', () => {
    // The module owns no strings, so an absent label is silence rather than an invented English one.
    const rows = sessionRows(group(['ship the cockpit']), 'closed')
    const head = rows.find(r => r.kind === 'heading') as { label: string }
    expect(head.label).not.toContain('·')
  })
})

describe('projectCounts', () => {
  it('counts sessions per project, busiest first, ties by name', () => {
    const counts = projectCounts([
      session('a', { project: 'agentistics' }),
      session('b', { project: 'agentistics' }),
      session('c', { project: 'zuke' }),
      session('d', { project: 'aipe' }),
    ])
    expect(counts).toEqual([
      { name: 'agentistics', count: 2 },
      { name: 'aipe', count: 1 },
      { name: 'zuke', count: 1 },
    ])
  })

  it('omits a session with no project rather than inventing a bucket for it', () => {
    expect(projectCounts([session('a', { project: '' })])).toEqual([])
  })
})

describe('the task cell', () => {
  const filed = [
    session('a', { stateLabel: 'waiting', title: 'migrate the auth store', task: 'billing' }),
    session('b', { stateLabel: 'waiting', title: 'flaky test hunt' }),
  ]

  it('is a column of its own, sized to the widest task on screen', () => {
    expect(sessionColumns(filed, 140).task).toBe('billing'.length)
  })

  it('is ABSENT while grouping by task, where the heading already says it', () => {
    // A column repeating the word in the heading above every row under it is not information.
    expect(sessionColumns(filed, 140, { groupedByTask: true }).task).toBe(0)
  })

  it('draws no column when nothing on screen is filed', () => {
    expect(sessionColumns([session('b', { stateLabel: 'waiting', title: 'x' })], 140).task).toBe(0)
  })

  it('outlives the usage, the harness and the directory as the row narrows', () => {
    const rows = [session('a', {
      stateLabel: 'needs approval', title: 'migrate the auth store', task: 'billing',
      tokens: '51.7k', cost: '$1.24', harness: 'claude', project: 'agentistics',
    })]
    const lost = (pick: (c: ReturnType<typeof sessionColumns>) => number) => {
      for (let w = 220; w >= 4; w--) if (pick(sessionColumns(rows, w)) === 0) return w
      return 0
    }
    expect(lost(c => c.where)).toBeGreaterThan(lost(c => c.harness))
    expect(lost(c => c.harness)).toBeGreaterThan(lost(c => c.metrics))
    expect(lost(c => c.metrics)).toBeGreaterThan(lost(c => c.task))
  })
})

describe('sessionsCockpit budget', () => {
  const at = (height: number, detailWanted = 4) =>
    sessionsCockpit({ width: 120, height, asideLabel: 16, detailWanted })

  it('pays for every pane FRAME out of its own arithmetic', () => {
    // The screen draws three framed panes. A budget that hands out content rows and then lets the
    // component pay for the borders overspends by two rows per pane, and Ink COMPOSITES the
    // overflow rather than clipping it — which reads as a corrupted frame, not a cramped one.
    for (let h = 4; h <= 60; h++) {
      const l = at(h)
      expect(l.band + l.detail).toBeLessThanOrEqual(h)
      // Whatever the pane hands to content, plus its frame, is what the band was given.
      expect(l.listRows + (l.summary ? 1 : 0)).toBeLessThanOrEqual(Math.max(1, l.band - 2))
    }
  })

  it('gives up the summary row before the last session row', () => {
    // The summary describes the list; a list with no rows left has nothing to describe.
    const tall = at(40)
    expect(tall.summary).toBe(true)
    const short = at(8)
    expect(short.listRows).toBeGreaterThanOrEqual(1)
    if (!short.summary) expect(short.listRows).toBeGreaterThanOrEqual(1)
  })

  it('always leaves at least one row for a session', () => {
    for (let h = 1; h <= 60; h++) expect(at(h).listRows).toBeGreaterThanOrEqual(1)
  })
})

describe('projectColumns', () => {
  const rows = [
    { name: 'session-monitor', repo: 'blpsoares/agentistics', path: '~/agentistics/…/worktrees/session-monitor', why: 'you worked here' },
    { name: 'embark', repo: '', path: '~/orgs/opvibes/embark', why: 'git repo' },
    { name: 'scratch', repo: '', path: '~/scratch', why: '' },
  ]
  const drawn = (c: ReturnType<typeof projectColumns>) => {
    const cells = [c.name, c.repo, c.path, c.why].filter(n => n > 0)
    return 2 + cells.reduce((a, b) => a + b, 0) + 2 * Math.max(0, cells.length - 1)
  }

  it('never draws a row wider than the pane it was measured against', () => {
    // Two columns too wide is not a cosmetic miss: the frame truncates every row of the table it
    // just measured, which is what the per-row sizing produced in the first place.
    for (let w = 20; w <= 200; w++) expect(drawn(projectColumns(rows, w))).toBeLessThanOrEqual(w)
  })

  it('sizes each column to the widest row ON THE PAGE, so the cells line up', () => {
    const c = projectColumns(rows, 160)
    expect(c.name).toBe('session-monitor'.length)
    expect(c.repo).toBe('blpsoares/agentistics'.length)
    expect(c.path).toBe('~/agentistics/…/worktrees/session-monitor'.length)
  })

  it('gives up the reason first, then the repo, and never the path', () => {
    const lost = (pick: (c: ReturnType<typeof projectColumns>) => number) => {
      for (let w = 200; w >= 20; w--) if (pick(projectColumns(rows, w)) === 0) return w
      return 0
    }
    expect(lost(c => c.why)).toBeGreaterThan(lost(c => c.repo))
    // The path answers "which one" — a machine with six directories of the same name renders six
    // identical rows without it. It is never given up, only shortened.
    for (let w = 20; w <= 200; w++) expect(projectColumns(rows, w).path).toBeGreaterThan(0)
    for (let w = 20; w <= 200; w++) expect(projectColumns(rows, w).name).toBeGreaterThan(0)
  })
})

describe('projectPickRows', () => {
  const row = (name: string, repo = '', path = `~/${name}`) => ({ name, repo, path, why: '' })

  it('groups by repository, keeping the order the search ranked them in', () => {
    // First appearance decides section order. Sorting alphabetically here would throw away the one
    // piece of ordering the search actually earned — the directory you are standing in is first.
    const sections = groupProjects([
      row('web', 'org/mono'), row('loose'), row('api', 'org/mono'), row('other', 'aaa/first'),
    ])
    expect(sections.map(s => s.repo)).toEqual(['org/mono', 'aaa/first', ''])
    expect(sections[0]!.rows.map(r => r.name)).toEqual(['web', 'api'])
  })

  it('does not group when there is nothing to separate', () => {
    // One section is not a grouping, it is a heading over the whole list.
    const only = projectPickRows([row('a'), row('b')], 'loose')
    expect(only.grouped).toBe(false)
    expect(only.rows.every(r => r.kind === 'project')).toBe(true)

    const oneRepo = projectPickRows([row('a', 'org/x'), row('b', 'org/x')], 'loose')
    expect(oneRepo.grouped).toBe(false)
  })

  it('keeps each row pointing at its ORIGINAL index, so enter picks what is highlighted', () => {
    const rows = [row('web', 'org/mono'), row('loose'), row('api', 'org/mono')]
    const { rows: drawn, grouped } = projectPickRows(rows, 'loose')
    expect(grouped).toBe(true)
    const picks = drawn.flatMap(r => (r.kind === 'project' ? [r] : []))
    // Drawn out of order, but every row still names the position it came from.
    expect(picks.map(p => p.row.name)).toEqual(['web', 'api', 'loose'])
    expect(picks.map(p => p.index)).toEqual([0, 2, 1])
  })
})

describe('the worktree cell', () => {
  const wt = [
    session('a', { stateLabel: 'waiting', title: 'one', worktree: true, project: 'session-monitor' }),
    session('b', { stateLabel: 'waiting', title: 'two', project: 'agentistics' }),
  ]

  it('draws nothing when no row on screen is a worktree', () => {
    const plain = [session('b', { stateLabel: 'waiting', title: 'two' })]
    expect(sessionColumns(plain, 140).worktree).toBe(0)
  })

  it('carries the worktree NAME, not the word "worktree"', () => {
    // Grouped by project the heading already says which project, so a cell repeating one word on
    // every such row told you the kind and never which one. Three checkouts are told apart here.
    expect(worktreeName(wt[0]!)).toBe('session-monitor')
    expect(worktreeName(wt[1]!)).toBe('')
    expect(sessionColumns(wt, 140).worktree).toBe('session-monitor'.length)
  })

  it('is given up before the name, and after nothing else', () => {
    const lost = (pick: (c: ReturnType<typeof sessionColumns>) => number) => {
      for (let w = 200; w >= 4; w--) if (pick(sessionColumns(wt, w)) === 0) return w
      return 0
    }
    expect(lost(c => c.worktree)).toBeLessThan(lost(c => c.where))
  })
})

describe('sessionHandle', () => {
  it('is the prefix `agentop session attach` resolves against', () => {
    expect(sessionHandle(session('3f5f4dd461'))).toBe('3f5f4')
  })

  it('is EMPTY for a row agentop did not name', () => {
    // An external process and a closed conversation are named by the harness. Showing five
    // characters of a synthetic id offers a handle the CLI cannot resolve.
    expect(sessionHandle(session('external:claude:/repo:0'))).toBe('')
    expect(sessionHandle(session('closed:abc-def'))).toBe('')
  })
})

describe('asideSections', () => {
  const rows: Parameters<typeof asideSections>[0] = [
    { kind: 'heading', label: 'ACTIONS' },
    { kind: 'action', action: 'attach', label: 'Attach', enabled: true },
    { kind: 'action', action: 'kill', label: 'Stop', enabled: true },
    { kind: 'rule' },
    { kind: 'heading', label: 'VIEW' },
    { kind: 'group', value: 'repo', label: 'repository', on: true },
    { kind: 'rule' },
    { kind: 'heading', label: 'EMPTY' },
  ]

  it('keeps every row pointing at its index in the FLAT menu', () => {
    // The cursor moves over one list. Sections that carried their own indexes would be a second
    // counting of the same menu, agreeing until the first boundary.
    const s = asideSections(rows)
    expect(s.map(x => x.title)).toEqual(['ACTIONS', 'VIEW'])
    expect(s[0]!.indexes).toEqual([1, 2])
    expect(s[1]!.indexes).toEqual([5])
  })

  it('drops a heading with nothing under it, rather than drawing a title over nothing', () => {
    expect(asideSections(rows).some(s => s.title === 'EMPTY')).toBe(false)
  })
})

describe('asideFold', () => {
  const sec = (n: number, title: string) => ({
    title,
    rows: Array.from({ length: n }, () => ({ kind: 'rule' as const })) as never[],
    indexes: Array.from({ length: n }, (_, i) => i),
  })
  const five = [sec(10, 'a'), sec(6, 'b'), sec(3, 'c'), sec(4, 'd'), sec(5, 'e')]
  const whole = five.reduce((n, s) => n + s.rows.length + 2, 0)
  const sum = (ns: readonly number[]) => ns.reduce((a: number, b: number) => a + b, 0)

  it('opens every section when the band can hold them all', () => {
    expect(asideFold(five, whole, 0)).toEqual([12, 8, 5, 6, 7])
  })

  it('leaves NO air under the last pane — it opens what the leftover can pay for', () => {
    // Collapsing everything but the active one and stopping there left fourteen blank rows under
    // the menu on a tall terminal. Air under a pane is a fault; air inside one is a pane.
    const band = whole - 6
    const got = asideFold(five, band, 0)!
    expect(sum(got)).toBe(band)
    expect(got.filter(n => n > 1).length).toBeGreaterThan(1)
  })

  it('keeps every section NAMED however short the band', () => {
    const got = asideFold(five, 8, 2)!
    expect(got).toHaveLength(5)
    expect(got.every(n => n >= 1)).toBe(true)
    expect(got[2]).toBe(8 - 4)
  })

  it('opens the section holding the cursor, whichever it is', () => {
    for (let at = 0; at < five.length; at++) {
      expect(asideFold(five, 9, at)![at]).toBeGreaterThan(1)
    }
  })

  it('spends the band EXACTLY, at any height or cursor', () => {
    // Not merely "no more than": a column that stops short of the list beside it leaves air under
    // the last pane, which the control center's own rule calls a fault.
    for (let band = 1; band <= 60; band++) {
      for (let at = 0; at < five.length; at++) {
        const got = asideFold(five, band, at)
        if (got) expect(sum(got)).toBe(band)
      }
    }
  })

  it('refuses when it cannot name them all and still open one', () => {
    expect(asideFold(five, 6, 0)).toBeNull()
  })

  it('leaves a section closed only when it genuinely does not fit', () => {
    // The others are walked in READING order and opened when they fit, so the menu does not
    // reorder itself; a closed box next to visible space would just be a row nobody is using.
    for (let band = 9; band <= 60; band++) {
      for (let at = 0; at < five.length; at++) {
        const got = asideFold(five, band, at)
        if (!got) continue
        const left = band - sum(got)
        got.forEach((n, i) => {
          if (i === at || n > 1) return
          expect(2 + five[i]!.rows.length - 1).toBeGreaterThan(left)
        })
      }
    }
  })
})

describe('scrollBar', () => {
  it('draws nothing at all when everything fits', () => {
    // A bar that is always there says "there is more" on the list that has no more, which is the
    // same class of lie as a confident zero.
    expect(scrollBar({ offset: 0, total: 5, rows: 10 })).toEqual([])
    expect(scrollBar({ offset: 0, total: 10, rows: 10 })).toEqual([])
  })

  it('puts the thumb at the top at the top, and at the bottom at the bottom', () => {
    const top = scrollBar({ offset: 0, total: 100, rows: 10 })
    const bottom = scrollBar({ offset: 90, total: 100, rows: 10 })
    expect(top[0]).toBe(THUMB)
    expect(top[top.length - 1]).toBe(TRACK)
    expect(bottom[bottom.length - 1]).toBe(THUMB)
    expect(bottom[0]).toBe(TRACK)
  })

  it('never fills the whole track, however long the list', () => {
    // A full-length thumb reads as "nothing to scroll" on exactly the list that has the most of it.
    for (const total of [11, 12, 20, 100, 5000]) {
      const bar = scrollBar({ offset: 0, total, rows: 10 })
      expect(bar).toHaveLength(10)
      expect(bar.filter(c => c === THUMB).length).toBeLessThan(10)
      expect(bar.filter(c => c === THUMB).length).toBeGreaterThanOrEqual(1)
    }
  })

  it('clamps an offset past the end instead of drawing off the track', () => {
    const bar = scrollBar({ offset: 9999, total: 100, rows: 10 })
    expect(bar).toHaveLength(10)
    expect(bar[bar.length - 1]).toBe(THUMB)
  })
})

describe('what a row that is no longer running offers', () => {
  const lost = session('a', {
    stateLabel: 'lost', state: 'lost' as SessionState, actionable: true, named: true,
    resume: { sessionId: 'c1', title: 'the work' },
  })

  it('offers REOPEN rather than attach — attaching to nothing is a button that only errors', () => {
    const offered = sessionActions(lost)
    expect(offered[0]!.action).toBe('resume')
    expect(offered[0]!.enabled).toBe(true)
    expect(offered.some(a => a.action === 'attach')).toBe(false)
  })

  it('keeps the verbs that edit what the user wrote', () => {
    // A reboot loses every backend session while the registry keeps every name. Losing rename,
    // note and task there is how a rename disappears.
    const by = Object.fromEntries(sessionActions(lost).map(a => [a.action, a.enabled]))
    expect(by.rename).toBe(true)
    expect(by.note).toBe(true)
    expect(by.task).toBe(true)
    expect(by.kill).toBe(true)
  })

  it('still offers attach on a row that IS running', () => {
    const live = session('b', { stateLabel: 'waiting', state: 'waiting' as SessionState })
    expect(sessionActions(live)[0]!.action).toBe('attach')
  })
})

describe('sessionNamed', () => {
  it('is what the user MARKED, never what the host derived', () => {
    // `title` always has a value — the host derives one when there is no label — so it can say
    // nothing about whether anyone chose it.
    expect(sessionNamed(session('a', { title: 'claude in agentistics' }))).toBe(false)
    expect(sessionNamed(session('a', { title: 'x', named: true }))).toBe(true)
  })
})

describe('grouping by project', () => {
  it('files a WORKTREE under the project it belongs to, not under its own folder', () => {
    // Three worktrees of one repository are three places to work on ONE project. Keying on the
    // directory name files them as three projects, which is the split the repository dimension
    // exists to avoid — and it is the default grouping, so it is the first thing anyone sees.
    const g = groupSessions([
      session('a', { project: 'session-monitor', projectGroup: 'agentistics' }),
      session('b', { project: 'agentistics' }),
      session('c', { project: 'billing-basis', projectGroup: 'agentistics' }),
    ], 'project', UNKNOWN)
    expect(g).toHaveLength(1)
    expect(g[0]!.key).toBe('agentistics')
    expect(g[0]!.sessions).toHaveLength(3)
  })

  it('falls back to the directory when the session belongs to no repository', () => {
    const g = groupSessions([session('a', { project: 'scratch' })], 'project', UNKNOWN)
    expect(g[0]!.key).toBe('scratch')
  })
})

describe('sessionRunning', () => {
  it('is the three states that mean something is alive on the other end', () => {
    const at = (state: SessionState) => sessionRunning(session('a', { state }))
    expect(at('working')).toBe(true)
    expect(at('waiting')).toBe(true)
    expect(at('waiting-approval')).toBe(true)
    // An EXTERNAL session wears `unknown`, and it is running: the row exists because a live
    // assistant process was found. What cannot be read there is the activity, not the existence —
    // and treating the one as the other hid every session started outside agentop from the one
    // filter meant to show what is happening.
    expect(at('unknown')).toBe(true)
    expect(at('exited')).toBe(false)
    expect(at('lost')).toBe(false)
    expect(at('closed')).toBe(false)
  })
})

describe('the only-active toggle', () => {
  const build = (showUnfiled: boolean) => asideRows({
    actions: sessionActions(session('m')),
    actionWords: {
      attach: 'A', resume: 'R', rename: 'N', note: 'O', task: 'T', kill: 'K',
      openTask: 'OT', finishTask: 'FT', new: 'NW', search: 'S', group: 'G',
    },
    grouping: 'project',
    groupWords: {
      repo: 'repository', none: 'flat', task: 'task', harness: 'harness', model: 'model',
      project: 'project',
    },
    toggles: { closed: false, exited: false, unfiled: false, done: false, active: true, detail: false },
    toggleWords: {
      closed: 'closed', exited: 'finished', unfiled: 'no task', done: 'done tasks',
      active: 'only active', detail: 'detail',
    },
    headings: { actions: 'ACTIONS', view: 'VIEW', show: 'SHOW' },
    showUnfiled,
  })

  it('leads the SHOW block, because it overrides the three under it', () => {
    // A switch that appears to do nothing is one people conclude is broken. Listed first it reads
    // as what it is: the strict answer, with the widening ones beneath.
    for (const unfiled of [false, true]) {
      const rows = build(unfiled)
      const show = rows.findIndex(r => r.kind === 'heading' && r.label === 'SHOW')
      expect(rows[show + 1]).toMatchObject({ kind: 'toggle', toggle: 'active', on: true })
    }
  })
})

describe('resolveAsideCursor', () => {
  const rows: Parameters<typeof resolveAsideCursor>[0] = [
    { kind: 'heading', label: 'ACTIONS' },
    { kind: 'action', action: 'attach', label: 'Attach', enabled: true },
    { kind: 'action', action: 'kill', label: 'Stop', enabled: true },
    { kind: 'rule' },
    { kind: 'heading', label: 'VIEW' },
    { kind: 'group', value: 'project', label: 'project', on: true },
    { kind: 'toggle', toggle: 'active', label: 'only active', on: true },
  ]

  it('keeps the cursor on the SAME row when the list is rebuilt around it', () => {
    // The cursor used to be an index into the selectable rows, and which verbs are enabled depends
    // on the selected session — so moving down the fleet renumbered every row beneath the actions
    // block and the menu cursor jumped, usually into the first section, which then opened.
    const shorter: typeof rows = [
      { kind: 'heading', label: 'ACTIONS' },
      { kind: 'action', action: 'resume', label: 'Reopen', enabled: true },
      { kind: 'rule' },
      { kind: 'heading', label: 'VIEW' },
      { kind: 'group', value: 'project', label: 'project', on: true },
      { kind: 'toggle', toggle: 'active', label: 'only active', on: true },
    ]
    expect(asideRowKey(rows[6]!)).toBe('toggle:active')
    expect(resolveAsideCursor(shorter, 'toggle:active')).toBe(5)
    expect(asideRowKey(shorter[5]!)).toBe('toggle:active')
  })

  it('lands on the NEAREST selectable row when its own row is gone', () => {
    // A verb that becomes unavailable moves the cursor one place, never to the top of the menu —
    // the top is in the first section, and landing there opens it.
    const without: typeof rows = rows.filter(r => !(r.kind === 'action' && r.action === 'kill'))
    const at = resolveAsideCursor(without, 'action:kill')
    expect(at).toBeGreaterThan(0)
    expect(without[at]!.kind).not.toBe('heading')
  })

  it('never lands on a heading, a rule, or a disabled verb', () => {
    const disabled: typeof rows = rows.map(r =>
      r.kind === 'action' && r.action === 'kill' ? { ...r, enabled: false } : r)
    const at = resolveAsideCursor(disabled, 'action:kill')
    const row = disabled[at]!
    expect(row.kind).not.toBe('heading')
    expect(row.kind).not.toBe('rule')
    if (row.kind === 'action') expect(row.enabled).toBe(true)
  })

  it('reports -1 when there is nothing to land on at all', () => {
    expect(resolveAsideCursor([{ kind: 'heading', label: 'X' }], 'action:attach')).toBe(-1)
  })
})

describe('sortSessions', () => {
  const rows = [
    session('a', { title: 'zebra', state: 'exited' as SessionState, startedAt: 300, tokens: '1.2M' }),
    session('b', { title: 'alpha', state: 'waiting' as SessionState, startedAt: 100, tokens: '9.9k' }),
    session('c', { title: 'mango', state: 'waiting-approval' as SessionState, startedAt: 200, tokens: '5' }),
  ]
  const ids = (o: Parameters<typeof sortSessions>[1]) => sortSessions(rows, o).map(s => s.id)

  it('puts what is blocked on you first by default', () => {
    expect(ids(DEFAULT_ORDER)).toEqual(['c', 'b', 'a'])
  })

  it('reads the SUFFIX when ordering by usage', () => {
    // `9.9k` above `1.2M` would point the column that exists to show what is expensive at the
    // cheapest row on the screen.
    expect(usageOf(session('x', { tokens: '1.2M' }))).toBe(1_200_000)
    expect(usageOf(session('x', { tokens: '9.9k' }))).toBe(9_900)
    expect(usageOf(session('x'))).toBe(0)
    expect(ids({ by: 'usage', dir: 'desc' })).toEqual(['a', 'b', 'c'])
  })

  it('orders by name in the direction the key is USEFUL in, and flips', () => {
    // `desc` names the useful direction for every key — most urgent, A to Z, largest, newest — so
    // there is one convention rather than a per-key argument about which way its "descending" runs.
    expect(ids({ by: 'name', dir: 'desc' })).toEqual(['b', 'c', 'a'])
    expect(ids({ by: 'name', dir: 'asc' })).toEqual(['a', 'c', 'b'])
  })

  it('orders by start time, newest first', () => {
    expect(ids({ by: 'started', dir: 'desc' })).toEqual(['a', 'c', 'b'])
    expect(ids({ by: 'started', dir: 'asc' })).toEqual(['b', 'c', 'a'])
  })

  it('keeps STATE as the tiebreak of every other key', () => {
    // A screen sorted by name that buries a session waiting on approval among nine idle ones has
    // lost the thing it is for.
    const tied = [
      session('x', { title: 'same', state: 'exited' as SessionState }),
      session('y', { title: 'same', state: 'waiting-approval' as SessionState }),
    ]
    expect(sortSessions(tied, { by: 'name', dir: 'desc' }).map(s => s.id)).toEqual(['y', 'x'])
  })

  it('never mutates what it was given', () => {
    const before = rows.map(s => s.id)
    sortSessions(rows, { by: 'name', dir: 'asc' })
    expect(rows.map(s => s.id)).toEqual(before)
  })
})

describe('planSubmit', () => {
  const harness = { id: 'claude', supportsModel: true }

  it('NAMES every refusal instead of returning silently', () => {
    // The component's version was `if (!spawn || !draft.harness || !draft.cwd) return`. The final
    // enter of a six-step wizard did nothing at all, with no way to tell a dead key from a slow
    // one — and the prompt just typed was still on screen, about to be thrown away.
    expect(planSubmit({ draft: { harness, cwd: '/r' }, hasSpawn: false, attach: false }))
      .toEqual({ ok: false, reason: 'no-host' })
    expect(planSubmit({ draft: { cwd: '/r' }, hasSpawn: true, attach: false }))
      .toEqual({ ok: false, reason: 'no-harness', step: 'harness' })
    expect(planSubmit({ draft: { harness }, hasSpawn: true, attach: false }))
      .toEqual({ ok: false, reason: 'no-cwd', step: 'where' })
  })

  it('sends a refusal BACK to the step that takes the missing answer', () => {
    // A refusal with nowhere to go is a dead end; with a step it is a way back.
    const noCwd = planSubmit({ draft: { harness }, hasSpawn: true, attach: false })
    expect(noCwd.ok).toBe(false)
    if (!noCwd.ok) expect(noCwd.step).toBe('where')
  })

  it('carries only what was actually answered', () => {
    // An empty model is not a model called "".
    const plan = planSubmit({
      draft: { harness, cwd: '/r', prompt: 'do the thing', model: '', task: 'auth' },
      hasSpawn: true,
      attach: true,
    })
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.req).toEqual({
        harness: 'claude', cwd: '/r', attach: true, prompt: 'do the thing', task: 'auth',
      })
      expect('model' in plan.req).toBe(false)
    }
  })

  it('keeps the prompt in the request, which is the expensive thing on that screen', () => {
    const plan = planSubmit({
      draft: { harness, cwd: '/r', prompt: 'p' }, hasSpawn: true, attach: false,
    })
    if (plan.ok) expect(plan.req.prompt).toBe('p')
  })
})

describe('sessionAge', () => {
  const ago = (s: number) => `${s}s`

  it('says nothing for a row that is running', () => {
    // A live session's age is idle curiosity; the column exists for the "reopen this or not"
    // decision, and a running row spends it on nothing.
    const live = session('a', { state: 'waiting' as SessionState, startedAt: 0 })
    expect(sessionAge(live, 60_000, ago)).toBe('')
  })

  it('says how long ago a row that is DOWN began', () => {
    const down = session('a', { state: 'lost' as SessionState, startedAt: 0 })
    expect(sessionAge(down, 60_000, ago)).toBe('60s')
  })

  it('says nothing when nobody recorded a start', () => {
    // Absent is absent. A start time nobody has is not "1970", and rendering it as fifty-six years
    // is worse than a blank.
    const down = session('a', { state: 'lost' as SessionState })
    expect(sessionAge(down, 60_000, ago)).toBe('')
  })

  it('never reports a negative age', () => {
    const down = session('a', { state: 'exited' as SessionState, startedAt: 90_000 })
    expect(sessionAge(down, 60_000, ago)).toBe('0s')
  })
})

describe('sessionKeyHelp', () => {
  const words = Object.fromEntries(
    ['move', 'open', 'attach', 'menu', 'section', 'newSession', 'search', 'clear', 'kill',
      'rename', 'note', 'task', 'mark', 'onlyActive', 'closed', 'exited', 'unfiled', 'group',
      'detail', 'reset', 'tabs', 'help', 'quit'].map(k => [k, `does ${k}`]),
  ) as Parameters<typeof sessionKeyHelp>[0]

  it('describes every key it lists, with no blanks', () => {
    const rows = sessionKeyHelp(words)
    expect(rows.length).toBeGreaterThan(15)
    for (const r of rows) {
      expect(r.keys.length).toBeGreaterThan(0)
      expect(r.what.length).toBeGreaterThan(0)
    }
  })

  it('names each keystroke once', () => {
    // Two rows claiming the same key is the reference disagreeing with itself.
    const keys = sessionKeyHelp(words).map(r => r.keys)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('sizes the keystroke column to its widest row', () => {
    const rows = sessionKeyHelp(words)
    expect(keyHelpColumn(rows)).toBe(Math.max(...rows.map(r => r.keys.length)))
    expect(keyHelpColumn([])).toBe(0)
  })
})
