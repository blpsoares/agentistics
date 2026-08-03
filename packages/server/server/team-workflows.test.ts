import { test, expect } from 'bun:test'
import type { WorkflowRun } from '@agentistics/core'
import { teamWorkflowDocId, toTeamWorkflowDoc, fromTeamWorkflowDoc } from './team-workflows'

function run(runId: string, startedAt = '2026-06-01T10:00:00.000Z'): WorkflowRun {
  return {
    runId,
    name: 'review-changes',
    sessionId: 'sess1',
    status: 'completed',
    startedAt,
    durationMs: 1234,
    phases: [{ title: 'Review', agentCount: 2 }],
    agents: [],
    totals: { agentCount: 2, tokensIn: 10, tokensOut: 20, costUSD: 0.5, durationMs: 1234, toolUses: 3 },
  }
}

test('teamWorkflowDocId composes org:memberId:runId', () => {
  expect(teamWorkflowDocId('acme', 'memberHash123', 'wf_abc')).toBe('acme:memberHash123:wf_abc')
})

test('toTeamWorkflowDoc sets identity fields without mutating the input', () => {
  const r = run('wf_abc')
  const doc = toTeamWorkflowDoc(r, 'acme', 'm1', 'devA')
  expect(doc._id).toBe('acme:m1:wf_abc')
  expect(doc.org).toBe('acme')
  expect(doc.memberId).toBe('m1')
  expect(doc.user).toBe('devA')
  expect(r.user).toBeUndefined()
})

test('startedAt is stored as a BSON Date, never as a string', () => {
  const doc = toTeamWorkflowDoc(run('wf_abc'), 'acme', 'm1', 'devA')
  expect(doc.startedAt).toBeInstanceOf(Date)
  expect(doc.startedAt!.toISOString()).toBe('2026-06-01T10:00:00.000Z')
})

test("an unknown start ('' on the wire) is stored as null, not as an empty pseudo-date", () => {
  expect(toTeamWorkflowDoc(run('wf_abc', ''), 'acme', 'm1', 'devA').startedAt).toBeNull()
})

test('round-trip returns startedAt to its ISO wire shape', () => {
  const r = run('wf_abc')
  expect(fromTeamWorkflowDoc(toTeamWorkflowDoc(r, 'acme', 'm1', 'devA')).startedAt).toBe(r.startedAt)
})

test('a run with no known start round-trips back to the empty string', () => {
  expect(fromTeamWorkflowDoc(toTeamWorkflowDoc(run('wf_abc', ''), 'acme', 'm1', 'devA')).startedAt).toBe('')
})

test('fromTeamWorkflowDoc reads a LEGACY doc whose startedAt is still a string', () => {
  const legacy = { ...toTeamWorkflowDoc(run('wf_abc'), 'acme', 'm1', 'devA'), startedAt: '2026-06-02T08:00:00.000Z' }
  expect(fromTeamWorkflowDoc(legacy).startedAt).toBe('2026-06-02T08:00:00.000Z')
})

test('fromTeamWorkflowDoc drops the identity fields it added', () => {
  const meta = fromTeamWorkflowDoc(toTeamWorkflowDoc(run('wf_abc'), 'acme', 'm1', 'devA')) as unknown as Record<string, unknown>
  expect(meta._id).toBeUndefined()
  expect(meta.org).toBeUndefined()
  expect(meta.memberId).toBeUndefined()
  expect(meta.user).toBe('devA')
})
