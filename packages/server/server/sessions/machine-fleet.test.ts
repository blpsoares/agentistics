import { describe, it, expect } from 'bun:test'
import { buildMachineFleetReply, type MachineFleetDeps } from './machine-fleet'

function row(id: string, cwd: string, extra: Record<string, unknown> = {}) {
  return {
    id, title: `session ${id}`, harness: 'claude', state: 'working', stateLabel: 'working',
    project: cwd.split('/').pop() ?? '', cwd,
    lastLines: ['$ secret command'], chatTurns: [{ role: 'user', text: 'sk-live-abc' }],
    ...extra,
  }
}

function deps(rows: Record<string, unknown>[], attention = 0, unavailable?: string): MachineFleetDeps {
  return {
    readFleet: async () => ({ rows, attention, ...(unavailable ? { unavailable } : {}) }),
    readIndexSources: async () => ({
      sessions: [
        { session_id: 'a', project_path: '/home/me/alpha', git_remote: 'github.com/o/alpha' },
        { session_id: 'b', project_path: '/home/me/beta', git_remote: 'github.com/o/beta' },
      ],
      projects: [
        { path: '/home/me/alpha', gitRemote: 'github.com/o/alpha' },
        { path: '/home/me/beta', gitRemote: 'github.com/o/beta' },
      ],
    }),
  }
}

const ALL = [row('1', '/home/me/alpha'), row('2', '/home/me/beta')]

describe('buildMachineFleetReply', () => {
  it('answers NOTHING when the machine has not agreed — silence is not an empty fleet', () => {
    // An empty list is a statement about the fleet; null is a statement about consent, and the
    // central keeps them as different sentences.
    return Promise.all([
      buildMachineFleetReply({}, 'en', deps(ALL)),
      buildMachineFleetReply({ allowRemoteSessions: false }, 'en', deps(ALL)),
      // A screen grant with no fleet grant agrees to nothing — resolveRemoteConsent's rule.
      buildMachineFleetReply({ allowRemoteScreens: true }, 'en', deps(ALL)),
    ]).then(rs => rs.forEach(r => expect(r).toBeNull()))
  })

  it('relays every row under an unrestricted denylist, and nothing is withheld', async () => {
    const r = (await buildMachineFleetReply({ allowRemoteSessions: true }, 'en', deps(ALL)))!
    expect(r.rows.map(x => x.id)).toEqual(['1', '2'])
    expect(r.withheld).toBe(0)
  })

  it('never relays the screen or the conversation, whatever the rules say', async () => {
    const r = (await buildMachineFleetReply({ allowRemoteSessions: true }, 'en', deps(ALL)))!
    for (const relayed of r.rows as unknown as Record<string, unknown>[]) {
      expect(relayed.lastLines).toBeUndefined()
      expect(relayed.chatTurns).toBeUndefined()
    }
  })

  it('a denied repository never becomes a row, and is COUNTED', async () => {
    const r = (await buildMachineFleetReply({
      allowRemoteSessions: true, shareMode: 'denylist',
      sources: [{ type: 'repo', value: 'github.com/o/beta' }],
    }, 'en', deps(ALL)))!
    expect(r.rows.map(x => x.id)).toEqual(['1'])
    // Reported rather than silently subtracted: "some sessions are not shared with this central"
    // is a sentence, not an absence.
    expect(r.withheld).toBe(1)
  })

  it('an allowlist relays only what it names', async () => {
    const r = (await buildMachineFleetReply({
      allowRemoteSessions: true, shareMode: 'allowlist',
      sources: [{ type: 'repo', value: 'github.com/o/beta' }],
    }, 'en', deps(ALL)))!
    expect(r.rows.map(x => x.id)).toEqual(['2'])
    expect(r.withheld).toBe(1)
  })

  it('an EMPTY allowlist relays nothing — it is the strictest rule, not the absence of one', async () => {
    const r = (await buildMachineFleetReply({
      allowRemoteSessions: true, shareMode: 'allowlist', sources: [],
    }, 'en', deps(ALL)))!
    expect(r.rows).toEqual([])
    expect(r.withheld).toBe(2)
  })

  it('a directory the index cannot resolve is WITHHELD under any rule in force', async () => {
    // Positive resolution only — cwdShared's rule. Under a denylist an unknown path would
    // otherwise read as shared, and cwd is the sensitive field here.
    const rows = [...ALL, row('3', '/somewhere/unknown')]
    const r = (await buildMachineFleetReply({
      allowRemoteSessions: true, shareMode: 'denylist',
      sources: [{ type: 'repo', value: 'github.com/o/beta' }],
    }, 'en', deps(rows)))!
    expect(r.rows.map(x => x.id)).toEqual(['1'])
    expect(r.withheld).toBe(2)
  })

  it('a row with NO directory is withheld once any rule is in force, and kept when none is', async () => {
    const rows = [row('1', '/home/me/alpha'), row('9', '')]
    const restricted = (await buildMachineFleetReply({
      allowRemoteSessions: true, shareMode: 'denylist',
      sources: [{ type: 'repo', value: 'github.com/o/beta' }],
    }, 'en', deps(rows)))!
    expect(restricted.rows.map(x => x.id)).toEqual(['1'])
    const open = (await buildMachineFleetReply({ allowRemoteSessions: true }, 'en', deps(rows)))!
    expect(open.rows.map(x => x.id)).toEqual(['1', '9'])
  })

  it('attention is the MACHINE\'s own count over its unfiltered fleet', async () => {
    // Recomputing it from the relayed rows would answer "how many of the ones you may see" under
    // the same name.
    const r = (await buildMachineFleetReply({
      allowRemoteSessions: true, shareMode: 'allowlist', sources: [],
    }, 'en', deps(ALL, 3)))!
    expect(r.rows).toEqual([])
    expect(r.attention).toBe(3)
  })

  it("carries the machine's own sentence about an incomplete list", async () => {
    const r = (await buildMachineFleetReply({ allowRemoteSessions: true }, 'en', deps(ALL, 0, 'tmux is not installed')))!
    expect(r.unavailable).toBe('tmux is not installed')
  })
})
