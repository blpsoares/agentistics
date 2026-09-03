import { describe, it, expect } from 'bun:test'
import { buildMachineFleetReply, performMachineAction, type MachineFleetDeps } from './machine-fleet'

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

const WITH_VERBS = [row('1', '/home/me/alpha', {
  verbs: [
    { action: 'rename', label: 'Rename', enabled: true },
    { action: 'kill', label: 'Kill', enabled: true },
    { action: 'approve', label: 'Approve', enabled: true },
    { action: 'prompt', label: 'Send', enabled: true },
  ],
})]

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

  it('relays only the verbs a central may drive — approve and prompt never appear', async () => {
    // Narrowed BEFORE the reduction, so a verb this machine would refuse never reaches the button.
    // Offering one and refusing it on the click is the control that reads as broken.
    const r = (await buildMachineFleetReply({ allowRemoteSessions: true }, 'en', deps(WITH_VERBS)))!
    expect(r.rows[0]!.verbs!.map(v => v.action)).toEqual(['rename', 'kill'])
  })

  it('the screen consent does NOT unlock approve or prompt — they are not implemented', async () => {
    const r = (await buildMachineFleetReply({ allowRemoteSessions: true, allowRemoteScreens: true }, 'en', deps(WITH_VERBS)))!
    expect(r.rows[0]!.verbs!.map(v => v.action)).toEqual(['rename', 'kill'])
  })

  it("carries the machine's own sentence about an incomplete list", async () => {
    const r = (await buildMachineFleetReply({ allowRemoteSessions: true }, 'en', deps(ALL, 0, 'tmux is not installed')))!
    expect(r.unavailable).toBe('tmux is not installed')
  })
})

describe('performMachineAction', () => {
  const ran: { id: string; action: string; text?: string }[] = []
  const deps = {
    runAction: async (_l: never, r: { id: string; action: string; text?: string }) => {
      ran.push(r)
      return { ok: true, message: 'done' }
    },
  } as never

  it('performs a screenless verb once the machine has agreed', async () => {
    for (const action of ['rename', 'note', 'task', 'interrupt', 'kill', 'resume', 'openTask', 'finishTask']) {
      const r = await performMachineAction({ allowRemoteSessions: true }, 'en', { action, id: 's1' }, deps)
      expect(r.ok).toBe(true)
    }
  })

  it('refuses everything without the consent, and never runs the verb', async () => {
    // The machine is the authority; a check that runs only on the central is not a check.
    const before = ran.length
    const r = await performMachineAction({}, 'en', { action: 'kill', id: 's1' }, deps)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/does not allow/)
    expect(ran.length).toBe(before)
  })

  it('refuses approve and prompt by NAMING the screen, even with both switches on', async () => {
    // "Not allowed" would read the same for a verb that needs the screen and one that does not
    // exist. They are different problems and get different sentences.
    for (const action of ['approve', 'prompt']) {
      const r = await performMachineAction({ allowRemoteSessions: true, allowRemoteScreens: true }, 'en', { action, id: 's1' }, deps)
      expect(r.ok).toBe(false)
      expect(r.message).toMatch(/screen does not leave this machine/)
    }
  })

  it('refuses an unknown verb with its own sentence', async () => {
    const r = await performMachineAction({ allowRemoteSessions: true }, 'en', { action: 'wipe', id: 's1' }, deps)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/cannot be performed from a central/)
  })

  it('refuses a request that names no session', async () => {
    const r = await performMachineAction({ allowRemoteSessions: true }, 'en', { action: 'kill', id: '' }, deps)
    expect(r.ok).toBe(false)
  })

  it('carries the text through for the verbs that take one', async () => {
    ran.length = 0
    await performMachineAction({ allowRemoteSessions: true }, 'en', { action: 'rename', id: 's1', text: 'new name' }, deps)
    expect(ran[0]).toEqual({ id: 's1', action: 'rename', text: 'new name' })
  })

  it('every refusal is worded, in the asked-for language', async () => {
    for (const lang of ['en', 'pt'] as const) {
      const r = await performMachineAction({}, lang, { action: 'kill', id: 's1' }, deps)
      expect(r.message.length).toBeGreaterThan(10)
    }
    const en = await performMachineAction({}, 'en', { action: 'kill', id: 's1' }, deps)
    const pt = await performMachineAction({}, 'pt', { action: 'kill', id: 's1' }, deps)
    expect(en.message).not.toBe(pt.message)
  })
})
