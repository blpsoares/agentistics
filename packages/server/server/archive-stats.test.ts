import { describe, it, expect } from 'bun:test'
import type { StatsCache } from '@agentistics/core'
import { applyArchivedStats } from './data'

const mu = (input: number, output = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  webSearchRequests: 0,
  costUSD: 0,
})

describe('applyArchivedStats', () => {
  it('recovers dates the live cache no longer has, without duplicating existing ones', () => {
    const live = {
      dailyActivity: [{ date: '2026-05-01', messageCount: 5, sessionCount: 1, toolCallCount: 2 }],
    } as unknown as StatsCache
    const snap = {
      dailyActivity: [
        { date: '2026-01-10', messageCount: 9, sessionCount: 3, toolCallCount: 7 }, // deleted from live
        { date: '2026-05-01', messageCount: 999, sessionCount: 99, toolCallCount: 99 }, // live wins
      ],
    } as unknown as StatsCache

    applyArchivedStats(live, snap)

    expect(live.dailyActivity.map(d => d.date)).toEqual(['2026-01-10', '2026-05-01'])
    // live entry for 2026-05-01 is preserved, snapshot does not overwrite it
    expect(live.dailyActivity.find(d => d.date === '2026-05-01')!.messageCount).toBe(5)
  })

  it('takes per-field max for modelUsage (no double counting)', () => {
    const live = { modelUsage: { 'claude-opus': mu(100, 50) } } as unknown as StatsCache
    const snap = {
      modelUsage: {
        'claude-opus': mu(80, 70), // live input bigger, snap output bigger → max each
        'claude-haiku': mu(10, 5), // only in archive → added
      },
    } as unknown as StatsCache

    applyArchivedStats(live, snap)

    expect(live.modelUsage!['claude-opus']!.inputTokens).toBe(100)
    expect(live.modelUsage!['claude-opus']!.outputTokens).toBe(70)
    expect(live.modelUsage!['claude-haiku']!.inputTokens).toBe(10)
  })

  it('fills missing dailyModelTokens dates only', () => {
    const live = {
      dailyModelTokens: [{ date: '2026-05-01', tokensByModel: { 'claude-opus': 100 } }],
    } as unknown as StatsCache
    const snap = {
      dailyModelTokens: [
        { date: '2026-01-10', tokensByModel: { 'claude-opus': 42 } },
        { date: '2026-05-01', tokensByModel: { 'claude-opus': 9999 } },
      ],
    } as unknown as StatsCache

    applyArchivedStats(live, snap)

    expect(live.dailyModelTokens.map(d => d.date)).toEqual(['2026-01-10', '2026-05-01'])
    expect(live.dailyModelTokens.find(d => d.date === '2026-05-01')!.tokensByModel['claude-opus']).toBe(100)
  })
})
