import { describe, it, expect } from 'bun:test'
import { reduceMachineFleetRow, MACHINE_FLEET_ROW_KEYS } from './machineFleet'

/** A row shaped like the real `ControlSession`, carrying every sensitive field it can carry. */
const richRow = {
  id: 's1', title: 'Refactor the parser', harness: 'claude',
  state: 'waiting-approval', stateLabel: 'needs you',
  project: 'agentistics', cwd: '/home/me/agentistics',
  task: 'parser', note: 'left mid-edit', model: 'claude-opus-5',
  conversationId: 'conv-1', named: true,
  // Everything below must never cross to a central.
  lastLines: ['$ rm -rf /tmp/x', 'are you sure?'],
  chatTurns: [{ role: 'user', text: 'the API key is sk-live-abc123' }],
  approvalLines: ['1. Yes', '2. Yes, always', '3. No'],
  dialogOptions: [{ number: 1, label: 'Yes', selected: true }],
  attachCommand: 'agentop session attach s1',
  verbs: [{ action: 'kill', label: 'Kill', enabled: true }],
  approvalBlind: 'nobody has read this dialog',
  resume: { sessionId: 'conv-1', title: 'Refactor the parser' },
  pid: 4242,
  projectRoot: '/home/me/agentistics',
}

describe('reduceMachineFleetRow', () => {
  it('never carries the screen, the conversation or the dialog', () => {
    // The guarantee the whole feature rests on. A screen is the transcript with the formatting
    // left on, and on-demand chat retrieval was removed from this channel on purpose.
    const out = reduceMachineFleetRow(richRow) as unknown as Record<string, unknown>
    for (const forbidden of ['lastLines', 'chatTurns', 'approvalLines', 'dialogOptions', 'approvalBlind']) {
      expect(out[forbidden]).toBeUndefined()
      expect(Object.keys(out)).not.toContain(forbidden)
    }
  })

  it('carries ONLY the allowlisted keys — an unlisted field never crosses', () => {
    // An allowlist rather than a spread-and-delete: the difference is the NEXT field somebody adds
    // to ControlSession, which a delete-list would leak silently on every machine.
    const out = reduceMachineFleetRow({ ...richRow, somethingAddedLater: 'secret' }) as unknown as Record<string, unknown>
    for (const key of Object.keys(out)) {
      expect(MACHINE_FLEET_ROW_KEYS as readonly string[]).toContain(key)
    }
    expect(out.somethingAddedLater).toBeUndefined()
  })

  it('carries the identity, state and placement the account needs to recognise a session', () => {
    const out = reduceMachineFleetRow(richRow)
    expect(out).toEqual({
      id: 's1', title: 'Refactor the parser', harness: 'claude',
      state: 'waiting-approval', stateLabel: 'needs you',
      project: 'agentistics', cwd: '/home/me/agentistics',
      task: 'parser', note: 'left mid-edit', model: 'claude-opus-5',
      conversationId: 'conv-1', named: true,
      verbs: [{ action: 'kill', label: 'Kill', enabled: true }],
    })
  })

  it('a verb is rebuilt field by field, like the row itself', () => {
    // A FleetVerb that grew a field carrying screen text would otherwise ride along inside an
    // object nobody re-checked.
    const out = reduceMachineFleetRow({
      ...richRow,
      verbs: [{ action: 'kill', label: 'Kill', enabled: true, dialogPreview: '1. Yes  2. No', extra: 1 }],
    })
    expect(out.verbs).toEqual([{ action: 'kill', label: 'Kill', enabled: true }])
  })

  it('keeps a DISABLED verb and its reason — a vanished button explains nothing', () => {
    const out = reduceMachineFleetRow({
      ...richRow,
      verbs: [{ action: 'resume', label: 'Reopen', enabled: false, reason: 'no conversation to reopen' }],
    })
    expect(out.verbs).toEqual([{ action: 'resume', label: 'Reopen', enabled: false, reason: 'no conversation to reopen' }])
  })

  it('drops a malformed verb rather than rendering a nameless button', () => {
    const out = reduceMachineFleetRow({
      ...richRow,
      verbs: [{ label: 'Mystery' }, null, 'kill', { action: '', label: 'x' }, { action: 'note', label: 'Note', enabled: 'yes' }],
    })
    // The survivor keeps its identity and is DISABLED: `enabled` is trusted only as a literal
    // boolean, so a truthy value never turns into an offer.
    expect(out.verbs).toEqual([{ action: 'note', label: 'Note', enabled: false }])
  })

  it('falls back to the action id when the machine sent no label', () => {
    const out = reduceMachineFleetRow({ ...richRow, verbs: [{ action: 'kill', enabled: true }] })
    expect(out.verbs).toEqual([{ action: 'kill', label: 'kill', enabled: true }])
  })

  it('keeps the state label the MACHINE resolved — a central must not re-derive its vocabulary', () => {
    expect(reduceMachineFleetRow({ ...richRow, stateLabel: 'precisa de você' }).stateLabel)
      .toBe('precisa de você')
  })

  it('leaves an absent optional absent rather than writing undefined onto the wire', () => {
    const out = reduceMachineFleetRow({ id: 'a', title: 't', harness: 'claude', state: 'working', stateLabel: 'working', project: 'p', cwd: '/p' })
    expect('task' in out).toBe(false)
    expect('note' in out).toBe(false)
    expect('model' in out).toBe(false)
    expect('conversationId' in out).toBe(false)
  })

  it('an optional of the wrong type is dropped, never coerced', () => {
    const out = reduceMachineFleetRow({ ...richRow, task: 42, note: null, named: 'yes' }) as unknown as Record<string, unknown>
    expect('task' in out).toBe(false)
    expect('note' in out).toBe(false)
    expect('named' in out).toBe(false)
  })

  it('a row missing its required strings renders as empty, never as undefined cells', () => {
    const out = reduceMachineFleetRow({})
    expect(out).toEqual({ id: '', title: '', harness: '', state: '', stateLabel: '', project: '', cwd: '' })
  })
})
