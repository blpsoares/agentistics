import { describe, expect, it } from 'bun:test'
import {
  SUBAGENT_POLL_MS, runningCount, subagentCount, subagentStatusText, subagentsPollMs,
  subagentsStateOf, unmeasuredText, unpricedText, type SubagentRow,
} from './subagents'

const row = (o: Partial<SubagentRow> = {}): SubagentRow => ({
  agentId: 'a1', status: 'finished', tokens: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
  totalTokens: 4, costUSD: 0.01, toolCalls: 2, turns: 3, ...o,
})

describe('subagentsStateOf — three answers, never one empty box', () => {
  it('keeps "this harness cannot report them" apart from "it ran none"', () => {
    expect(subagentsStateOf({ ok: true, supported: false, message: 'codex does not…' }).phase).toBe('unsupported')
    expect(subagentsStateOf({ ok: true, supported: true, rows: [] })).toEqual({ phase: 'ready', rows: [] })
  })

  it('keeps a refusal apart from both', () => {
    expect(subagentsStateOf({ ok: false, message: 'gone' }).phase).toBe('failed')
  })
})

describe('subagentCount — the tab never says 0 for something it cannot count', () => {
  it('counts a supported session', () => {
    expect(subagentCount({ phase: 'ready', rows: [row(), row()] })).toBe(2)
    expect(subagentCount({ phase: 'ready', rows: [] })).toBe(0)
  })

  it('answers null wherever a count would be a claim', () => {
    expect(subagentCount({ phase: 'unsupported', message: 'x' })).toBe(null)
    expect(subagentCount({ phase: 'failed', message: 'x' })).toBe(null)
    expect(subagentCount({ phase: 'loading' })).toBe(null)
    expect(subagentCount(null)).toBe(null)
  })
})

describe('subagentsPollMs — only what can still change', () => {
  it('polls while an agent is running', () => {
    expect(subagentsPollMs({ phase: 'ready', rows: [row({ status: 'running' }), row()] })).toBe(SUBAGENT_POLL_MS)
    expect(runningCount({ phase: 'ready', rows: [row({ status: 'running' })] })).toBe(1)
  })

  it('stops once everything has stopped — the list costs a full read of the parent', () => {
    expect(subagentsPollMs({ phase: 'ready', rows: [row(), row({ status: 'failed' })] })).toBe(null)
    expect(subagentsPollMs({ phase: 'unsupported', message: 'x' })).toBe(null)
    expect(subagentsPollMs(null)).toBe(null)
  })
})

describe('the words', () => {
  it('gives stopped its own word and colour', () => {
    expect(subagentStatusText('stopped', false).text).toBe('stopped')
    expect(subagentStatusText('stopped', false).color).not.toBe(subagentStatusText('failed', false).color)
  })

  it('says why a number is missing instead of printing a zero', () => {
    // "It has not answered yet" and "it spent nothing" are different facts.
    expect(unmeasuredText(row({ totalTokens: null, status: 'running' }), false)).toBe('has not answered yet')
    expect(unmeasuredText(row({ totalTokens: null, status: 'finished' }), false)).toBe('no transcript to measure')
    expect(unmeasuredText(row(), false)).toBe(null)
  })

  it('says why a cost is missing when the tokens are not', () => {
    expect(unpricedText(row({ costUSD: null }), false)).toBe('no price for this model')
    expect(unpricedText(row({ costUSD: null, totalTokens: null }), false)).toBe(null)
    expect(unpricedText(row(), false)).toBe(null)
  })
})
