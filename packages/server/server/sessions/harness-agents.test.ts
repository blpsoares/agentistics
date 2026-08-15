import { describe, it, expect } from 'bun:test'
import { agentHeld, indexAgents, needsAgentView, parseHarnessAgents } from './harness-agents'

// Verbatim from `claude agents --json` on this machine, 2026-08-15. The first record is the
// session that reported "it appeared but I still cannot resume it".
const REAL = JSON.stringify([
  {
    pid: 508665, id: '581deab7', cwd: '/home/mithrandir/agentistics/.claude/worktrees/session-monitor',
    kind: 'background', startedAt: 1786762198260,
    sessionId: '581deab7-8aa7-4438-9371-5d4f1668c1ab', name: 'MAIN',
    status: 'busy', state: 'working',
  },
  {
    id: '1ebeee57', cwd: '/home/mithrandir', kind: 'background',
    sessionId: '1ebeee57-8336-4689-a391-14caf25c9221', name: 'teste multi sessoes',
  },
])

describe('parseHarnessAgents', () => {
  it('reads what the harness states about itself', () => {
    const [main] = parseHarnessAgents(REAL)
    expect(main).toMatchObject({
      sessionId: '581deab7-8aa7-4438-9371-5d4f1668c1ab',
      pid: 508665,
      kind: 'background',
      // The name the USER typed — recovered without reading a file, matching a pid, or guessing
      // from a directory, which is what every other source here has had to do.
      name: 'MAIN',
      // And the activity, which agentop otherwise derives by capturing the pane.
      state: 'working',
    })
  })

  it('drops a record with no conversation id rather than listing something unactionable', () => {
    // `sessionId` is the only field every consumer keys on. A row that cannot be correlated would
    // appear as a session nothing can act on, which is worse than absent.
    expect(parseHarnessAgents('[{"pid":1,"name":"x"}]')).toEqual([])
  })

  it('never throws on anything the command might print', () => {
    for (const junk of ['', 'not json', '{}', 'null', '[1,2,3]', '["a"]', '[[]]']) {
      expect(parseHarnessAgents(junk)).toEqual([])
    }
  })
})

describe('agentHeld / needsAgentView', () => {
  const index = indexAgents(parseHarnessAgents(REAL))
  const alive = () => true

  it('is HELD only when a process is actually running', () => {
    // Claude refuses to resume a conversation already running, and it refuses AFTER launching — so
    // without asking first the refusal is discovered by reading a dead pane, which is how three
    // rows called MAIN happened.
    expect(agentHeld(index, '581deab7-8aa7-4438-9371-5d4f1668c1ab', alive)).toBe(true)
    expect(agentHeld(index, 'some-conversation-that-ended', alive)).toBe(false)
  })

  it('being in the LIST is not being alive — the bug this distinction fixes', () => {
    // Measured: 8 records, only 2 with a pid. The other six were `background`/`blocked` with no
    // process at all — conversations the daemon still knows and nothing is running. Treating
    // presence as alive made the cockpit refuse to reopen a conversation nothing was holding, and
    // answer "open it where it already is" about a place that did not exist. Those six are
    // precisely what reopen is FOR.
    const idle = indexAgents(parseHarnessAgents(JSON.stringify([
      { sessionId: 'idle-1', kind: 'background', state: 'blocked', name: 'teste multi sessoes' },
    ])))
    expect(idle.has('idle-1')).toBe(true)      // it IS in the list…
    expect(agentHeld(idle, 'idle-1', alive)).toBe(false)  // …and nothing is holding it
  })

  it('a record can outlive its process, so the pid is confirmed', () => {
    expect(agentHeld(index, '581deab7-8aa7-4438-9371-5d4f1668c1ab', () => false)).toBe(false)
  })

  it('marks the sessions that can only be reached through the agent view', () => {
    // A background agent has no tty and no tmux: no terminal to attach to and no second copy that
    // may be started. Telling someone to "open it where it already is" names no place.
    expect(needsAgentView(index.get('581deab7-8aa7-4438-9371-5d4f1668c1ab'))).toBe(true)
    expect(needsAgentView(undefined)).toBe(false)
    expect(needsAgentView({ sessionId: 'x', kind: 'interactive' })).toBe(false)
  })
})
