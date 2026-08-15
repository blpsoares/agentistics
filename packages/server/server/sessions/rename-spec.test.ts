import { describe, expect, test } from 'bun:test'
import { HARNESS_ORDER, type HarnessId } from '@agentistics/core'
import {
  RENAME_SPECS,
  harnessRenameSupported,
  planHarnessRename,
  renameSpecFor,
  typableTitle,
  type RenamePlanInput,
} from './rename-spec'

/** Everything true, so each test can name the ONE thing it is changing. */
function input(over: Partial<RenamePlanInput> = {}): RenamePlanInput {
  return { harness: 'claude', title: 'nome novo', managed: true, running: true, dialogOpen: false, ...over }
}

describe('RENAME_SPECS', () => {
  test('covers every harness — a new one must be decided, not defaulted', () => {
    for (const h of HARNESS_ORDER) expect(h in RENAME_SPECS).toBe(true)
    expect(Object.keys(RENAME_SPECS).sort()).toEqual([...HARNESS_ORDER].sort())
  })

  test('claude renames with the command its own table publishes', () => {
    expect(RENAME_SPECS.claude?.line('cockpit rename')).toBe('/rename cockpit rename')
  })

  test('every spec records where it was read from', () => {
    for (const spec of Object.values(RENAME_SPECS)) {
      if (spec) expect(spec.verified).toMatch(/\d{4}-\d{2}-\d{2}/)
    }
  })

  test('claude is the only harness with a verified channel', () => {
    const supported = HARNESS_ORDER.filter(h => harnessRenameSupported(h))
    expect(supported).toEqual(['claude'])
  })

  test('an unknown harness has no spec rather than throwing', () => {
    expect(renameSpecFor(undefined)).toBeNull()
    expect(renameSpecFor('nope' as HarnessId)).toBeNull()
  })
})

describe('planHarnessRename', () => {
  test('sends the harness command on a live, unblocked, supported session', () => {
    expect(planHarnessRename(input())).toEqual({ kind: 'send', line: '/rename nome novo' })
  })

  test('a harness with no channel is skipped as unsupported, whatever else is true', () => {
    for (const h of HARNESS_ORDER.filter(x => x !== 'claude')) {
      expect(planHarnessRename(input({ harness: h }))).toEqual({ kind: 'skip', reason: 'unsupported' })
    }
  })

  test('unsupported outranks not-running — restarting a codex session would not help', () => {
    expect(planHarnessRename(input({ harness: 'codex', running: false })))
      .toEqual({ kind: 'skip', reason: 'unsupported' })
  })

  test('a session agentop does not host has no pane to type into', () => {
    expect(planHarnessRename(input({ managed: false }))).toEqual({ kind: 'skip', reason: 'external' })
  })

  test('a row that is not running keeps its agentop label alone', () => {
    expect(planHarnessRename(input({ running: false }))).toEqual({ kind: 'skip', reason: 'not-running' })
  })

  test('REFUSES while a dialog is open — the text would answer it, not rename anything', () => {
    expect(planHarnessRename(input({ dialogOpen: true }))).toEqual({ kind: 'skip', reason: 'dialog' })
  })

  test('a multi-line title is never typed — half of it would rename and half would be a prompt', () => {
    expect(planHarnessRename(input({ title: 'primeira\nsegunda' })))
      .toEqual({ kind: 'skip', reason: 'untypable' })
    expect(planHarnessRename(input({ title: 'primeira\r\nsegunda' })))
      .toEqual({ kind: 'skip', reason: 'untypable' })
  })

  test('an empty title is untypable — bare /rename is a different command', () => {
    expect(planHarnessRename(input({ title: '   ' }))).toEqual({ kind: 'skip', reason: 'untypable' })
  })

  test('a title the harness would read oddly is still sent verbatim', () => {
    // Sanitising somebody's chosen name silently is worse than letting it land as typed.
    expect(planHarnessRename(input({ title: '/help me' })))
      .toEqual({ kind: 'send', line: '/rename /help me' })
  })
})

describe('typableTitle', () => {
  test('accepts an ordinary single-line name, including accents and punctuation', () => {
    expect(typableTitle('sessões: revisão · 2')).toBe(true)
  })

  test('rejects blank and multi-line', () => {
    expect(typableTitle('')).toBe(false)
    expect(typableTitle('\n')).toBe(false)
    expect(typableTitle('a\nb')).toBe(false)
  })
})
