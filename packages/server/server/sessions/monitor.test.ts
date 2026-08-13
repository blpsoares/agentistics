import { describe, expect, it } from 'bun:test'
import { attentionCount, buildSessionViews } from './monitor'
import type { ManagedSession, BackendSession } from './types'
import type { HarnessProcess } from '../live-sessions'

const NOW = 1_000_000

const managed = (id: string, label?: string): ManagedSession => ({
  id, harness: 'claude', cwd: '/repo', createdAt: '2026-08-12T10:00:00.000Z',
  ...(label ? { label } : {}),
})
const backend = (id: string, alive = true, quietMs = 30_000): BackendSession => ({
  id, createdMs: NOW - 600_000, attached: false, alive, lastActivityMs: NOW - quietMs,
})

describe('buildSessionViews', () => {
  it('pairs a managed session with its frame and classifies it', () => {
    const views = buildSessionViews({
      nowMs: NOW,
      reconciled: [{ id: 'a1', managed: managed('a1', 'refactor'), backend: backend('a1'), status: 'running' }],
      captures: { a1: { ok: true, lines: ['❯', '? for shortcuts'] } },
      processes: [],
    })
    expect(views).toHaveLength(1)
    expect(views[0]!.id).toBe('a1')
    expect(views[0]!.label).toBe('refactor')
    expect(views[0]!.managed).toBe(true)
    expect(views[0]!.state).toBe('waiting-input')
  })

  it('lists an external process with NO attention state', () => {
    const procs: HarnessProcess[] = [{ harness: 'codex', cwd: '/other', startedMs: NOW - 60_000 }]
    const views = buildSessionViews({ nowMs: NOW, reconciled: [], captures: {}, processes: procs })
    expect(views).toHaveLength(1)
    expect(views[0]!.managed).toBe(false)
    expect(views[0]!.state).toBe('external')
    expect(views[0]!.attachable).toBe(false)
  })

  it('does not list a process that is one of our own managed sessions twice', () => {
    const views = buildSessionViews({
      nowMs: NOW,
      reconciled: [{ id: 'a1', managed: managed('a1'), backend: backend('a1'), status: 'running' }],
      captures: {},
      // the tmux-hosted claude appears in /proc too, in the SAME directory
      processes: [{ harness: 'claude', cwd: '/repo', startedMs: NOW - 600_000 }],
    })
    expect(views).toHaveLength(1)
    expect(views[0]!.managed).toBe(true)
  })

  it('sorts the ones waiting on the user to the top', () => {
    const views = buildSessionViews({
      nowMs: NOW,
      reconciled: [
        { id: 'busy', managed: managed('busy'), backend: backend('busy', true, 100), status: 'running' },
        { id: 'ask', managed: managed('ask'), backend: backend('ask'), status: 'running' },
      ],
      // The brief's original frame here was ['Enter to confirm · Esc to cancel'], which does NOT
      // classify as waiting-approval under the real (positional) rules in attention.ts: that footer
      // line is only recognised when it starts at column 0 with "Esc to cancel" — "Enter to
      // confirm · Esc to cancel" starts with "Enter", so neither the approval nor the input rules
      // match it and the frame falls through to idle-unknown. This frame instead reproduces the
      // SELECTED-OPTION line from fixtures/claude-approval-tool.txt (line 28: " ❯ 1. Yes"), which the
      // approval rule `/^[ \t ]*❯[ \t ]+\d+\.[ \t ]/` genuinely matches.
      captures: { ask: { ok: true, lines: ['❯ 1. Yes'] } },
      processes: [],
    })
    expect(views.map(v => v.id)).toEqual(['ask', 'busy'])
  })

  it('marks a session whose frame could not be read as unreadable, never as idle', () => {
    const views = buildSessionViews({
      nowMs: NOW,
      reconciled: [{ id: 'a1', managed: managed('a1'), backend: backend('a1'), status: 'running' }],
      captures: { a1: { ok: false, reason: 'backend-error' } },
      processes: [],
    })
    expect(views[0]!.state).toBe('unreadable')
  })

  it('keeps an exited session visible and not attachable', () => {
    const views = buildSessionViews({
      nowMs: NOW,
      reconciled: [{ id: 'a1', managed: managed('a1'), backend: backend('a1', false), status: 'exited' }],
      captures: {},
      processes: [],
    })
    expect(views[0]!.state).toBe('exited')
    expect(views[0]!.attachable).toBe(false)
    expect(views[0]!.killable).toBe(true)
  })

  it('keeps a lost session visible, killable and not attachable', () => {
    const views = buildSessionViews({
      nowMs: NOW,
      reconciled: [{ id: 'a1', managed: managed('a1'), status: 'lost' }],
      captures: {},
      processes: [],
    })
    expect(views[0]!.state).toBe('exited')
    expect(views[0]!.attachable).toBe(false)
  })
})

describe('attentionCount', () => {
  it('counts only the ones waiting on the user', () => {
    const views = buildSessionViews({
      nowMs: NOW,
      reconciled: [
        { id: 'ask', managed: managed('ask'), backend: backend('ask'), status: 'running' },
        { id: 'busy', managed: managed('busy'), backend: backend('busy', true, 100), status: 'running' },
      ],
      // See the sort test above for why this frame replaces the brief's original literal.
      captures: { ask: { ok: true, lines: ['❯ 1. Yes'] } },
      processes: [],
    })
    expect(attentionCount(views)).toBe(1)
  })
})
