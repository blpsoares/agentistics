import { describe, expect, it } from 'bun:test'
import {
  attentionOf, detailLines, groupSessions, rowWidth, selectableIndexes, sessionActions, sessionCells,
  sessionRows, sessionsLayout, sortSessions, summaryCells,
} from './sessions'
import type { ControlSession, SessionState } from './types'

const UNKNOWN = {
  harness: 'harness unknown', model: 'no model recorded', project: 'no directory', task: 'no task',
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

describe('sessionsLayout', () => {
  it('gives the detail pane exactly its lines plus a divider, and the list the rest', () => {
    // Sized to what it HAS to say, not to a constant: a pane budgeted at a fixed height leaves dead
    // rows under it, and air under a pane is what the control center calls a fault. The list takes
    // the difference, which is honest — a list with room to grow is a list, not air.
    const l = sessionsLayout(20, 3)
    expect(l.summary).toBe(true)
    expect(l.detail).toBe(4)
    expect(l.list).toBe(15)
    expect(l.list + l.detail + 1).toBe(20)
  })

  it('caps the detail pane at half the screen, however much it wants to say', () => {
    // A session carrying a long note must never push the list it was selected from off the screen.
    const l = sessionsLayout(20, 100)
    expect(l.detail).toBe(9)
    expect(l.list).toBe(10)
    expect(l.list + l.detail + 1).toBe(20)
  })

  it('draws no detail pane when nothing is selected', () => {
    const l = sessionsLayout(20, 0)
    expect(l.detail).toBe(0)
    expect(l.list).toBe(19)
  })

  it('drops the detail pane before it starves the list', () => {
    const l = sessionsLayout(7, 6)
    expect(l.detail).toBe(0)
    expect(l.list).toBe(6)
  })

  it('drops the summary row on a very short screen', () => {
    expect(sessionsLayout(5, 3).summary).toBe(false)
  })

  it('leaves no row unspent and none invented, at any height and any amount to say', () => {
    for (let h = 1; h <= 40; h++) {
      for (const wanted of [0, 1, 3, 5, 12, 200]) {
        const l = sessionsLayout(h, wanted)
        const used = l.list + l.detail + (l.summary ? 1 : 0)
        expect(used).toBe(Math.max(1, h))
        expect(l.list).toBeGreaterThanOrEqual(1)
        expect(l.detail).toBeGreaterThanOrEqual(0)
      }
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
    kill: 'Stop', openTask: 'Open whole task', new: 'New', search: 'Search', group: 'Group',
  }

  it('always offers the verbs that need no selection', () => {
    // The screen must be usable when the fleet is empty — which is exactly when someone most needs
    // to start something.
    expect(sessionActions(undefined)).toEqual(['new', 'search', 'group'])
  })

  it('offers attach and the metadata verbs on a session agentop runs', () => {
    const a = sessionActions(session('m'))
    expect(a[0]).toBe('attach')
    expect(a).toContain('rename')
    expect(a).toContain('kill')
  })

  it('offers reopen instead of attach on a row agentop does not run', () => {
    // A verb that cannot work is ABSENT, never present and refusing: there is no process of ours to
    // attach to, but the conversation can be reopened.
    const external = session('e', {
      state: 'unknown', actionable: false, resume: { sessionId: 's1', title: 'auth' },
    })
    expect(sessionActions(external)[0]).toBe('resume')
    expect(sessionActions(external)).not.toContain('attach')
    expect(sessionActions(external)).not.toContain('rename')
  })

  it('offers nothing row-specific when the harness cannot reopen by id', () => {
    const external = session('e', { state: 'unknown', actionable: false })
    expect(sessionActions(external)).toEqual(['new', 'search', 'group'])
  })

  it('offers the whole task only once the session is filed under one', () => {
    expect(sessionActions(session('m'))).not.toContain('openTask')
    expect(sessionActions(session('m', { task: 'XPTO' }))).toContain('openTask')
  })

  it('labels every verb it offers, in the caller language', () => {
    for (const a of sessionActions(session('m', { task: 'X' }))) {
      expect(words[a].length).toBeGreaterThan(0)
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
