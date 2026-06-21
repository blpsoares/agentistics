import { describe, test, expect } from 'bun:test'
import { calcStreak, calcLongestStreak, getDateRangeFilter, filterByHarness, computeHarnessSummaries } from './useData'
import { format, subDays } from 'date-fns'

// ── calcStreak ────────────────────────────────────────────────────────────────

describe('calcStreak', () => {
  // Fixed reference date at noon UTC — safe for all timezones (no day boundary ambiguity)
  const TODAY = new Date('2026-04-10T12:00:00.000Z')

  // Dates using format() to match the implementation (local time, not UTC slice)
  const d = (offset: number) => format(subDays(TODAY, offset), 'yyyy-MM-dd')

  test('set vazio → streak 0', () => {
    expect(calcStreak(new Set(), TODAY)).toBe(0)
  })

  test('somente hoje ativo → streak 1', () => {
    expect(calcStreak(new Set([d(0)]), TODAY)).toBe(1)
  })

  test('hoje e ontem ativos → streak 2', () => {
    expect(calcStreak(new Set([d(0), d(1)]), TODAY)).toBe(2)
  })

  test('3 dias consecutivos → streak 3', () => {
    expect(calcStreak(new Set([d(0), d(1), d(2)]), TODAY)).toBe(3)
  })

  test('gap interrompe streak — conta apenas do início até o gap', () => {
    // Hoje e anteontem ativos, ontem não → streak 1 (para em ontem)
    expect(calcStreak(new Set([d(0), d(2)]), TODAY)).toBe(1)
  })

  test('hoje sem atividade, ontem e anteontem ativos → streak 2', () => {
    // Comportamento intencional: hoje sem atividade não quebra o streak anterior
    expect(calcStreak(new Set([d(1), d(2)]), TODAY)).toBe(2)
  })

  test('hoje e ontem sem atividade → streak 0', () => {
    // Gap de dois dias: hoje não ativo (não quebra), ontem não ativo (quebra)
    expect(calcStreak(new Set([d(2), d(3)]), TODAY)).toBe(0)
  })

  test('atividade antiga sem continuidade até hoje → streak 0', () => {
    expect(calcStreak(new Set([d(10), d(11), d(12)]), TODAY)).toBe(0)
  })

  test('365 dias consecutivos → streak 365', () => {
    const dates = new Set(Array.from({ length: 365 }, (_, i) => d(i)))
    expect(calcStreak(dates, TODAY)).toBe(365)
  })
})

// ── calcLongestStreak ─────────────────────────────────────────────────────────

describe('calcLongestStreak', () => {
  const TODAY = new Date('2026-04-10T12:00:00.000Z')
  const d = (offset: number) => format(subDays(TODAY, offset), 'yyyy-MM-dd')

  test('set vazio → 0', () => {
    expect(calcLongestStreak(new Set())).toBe(0)
  })

  test('um único dia → 1', () => {
    expect(calcLongestStreak(new Set([d(0)]))).toBe(1)
  })

  test('3 dias consecutivos → 3', () => {
    expect(calcLongestStreak(new Set([d(0), d(1), d(2)]))).toBe(3)
  })

  test('gap no meio — maior bloco vence', () => {
    // d(0), d(1), d(2) = 3 dias; d(5), d(6) = 2 dias → maior = 3
    expect(calcLongestStreak(new Set([d(0), d(1), d(2), d(5), d(6)]))).toBe(3)
  })

  test('streak ativa menor que streak histórica', () => {
    // Streak ativa: d(0), d(1) = 2 dias; streak histórica: d(10)..d(15) = 6 dias
    const dates = new Set([d(0), d(1), d(10), d(11), d(12), d(13), d(14), d(15)])
    expect(calcLongestStreak(dates)).toBe(6)
  })

  test('dias isolados → 1', () => {
    expect(calcLongestStreak(new Set([d(0), d(5), d(10)]))).toBe(1)
  })
})

// ── getDateRangeFilter ────────────────────────────────────────────────────────

describe('getDateRangeFilter', () => {
  test('"all" sem customização → início do epoch até agora', () => {
    const { start, end } = getDateRangeFilter('all')
    expect(start.getTime()).toBe(new Date(0).getTime())
    expect(end.getTime()).toBeGreaterThan(Date.now() - 1000)
  })

  test('"7d" → start é startOfDay de 7 dias atrás, end é endOfDay de hoje', () => {
    const { start, end } = getDateRangeFilter('7d')
    // startOfDay(subDays) + endOfDay(hoje) = ~8 dias de diferença total
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBeGreaterThan(7.9)
    expect(diffDays).toBeLessThan(8.1)
  })

  test('"30d" → start é startOfDay de 30 dias atrás, end é endOfDay de hoje', () => {
    const { start, end } = getDateRangeFilter('30d')
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBeGreaterThan(30.9)
    expect(diffDays).toBeLessThan(31.1)
  })

  test('"90d" → start é startOfDay de 90 dias atrás, end é endOfDay de hoje', () => {
    const { start, end } = getDateRangeFilter('90d')
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    expect(diffDays).toBeGreaterThan(90.9)
    expect(diffDays).toBeLessThan(91.1)
  })

  test('"all" com datas customizadas → usa as datas fornecidas', () => {
    const { start, end } = getDateRangeFilter('all', '2026-01-01', '2026-03-31')
    expect(start.getFullYear()).toBe(2026)
    expect(start.getMonth()).toBe(0) // janeiro
    expect(end.getMonth()).toBe(2)   // março
  })

  test('customStart sem customEnd → end é agora', () => {
    const { start, end } = getDateRangeFilter('all', '2025-01-01')
    expect(start.getFullYear()).toBe(2025)
    expect(end.getTime()).toBeGreaterThan(Date.now() - 1000)
  })

  test('start sempre antes de end', () => {
    for (const range of ['7d', '30d', '90d', 'all'] as const) {
      const { start, end } = getDateRangeFilter(range)
      expect(start.getTime()).toBeLessThan(end.getTime())
    }
  })
})

// ── filterByHarness ───────────────────────────────────────────────────────────

describe('filterByHarness', () => {
  const sessions = [
    { session_id: '1', harness: 'claude' },
    { session_id: '2', harness: 'codex' },
  ] as any

  test('filterByHarness keeps only the chosen harness', () => {
    expect(filterByHarness(sessions, 'codex').map((s: any) => s.session_id)).toEqual(['2'])
  })

  test('filterByHarness with undefined returns all sessions', () => {
    expect(filterByHarness(sessions, undefined).length).toBe(2)
  })

  test('filterByHarness defaults missing harness to claude', () => {
    const mixed = [
      { session_id: 'a', harness: undefined },
      { session_id: 'b', harness: 'codex' },
    ] as any
    expect(filterByHarness(mixed, 'claude').map((s: any) => s.session_id)).toEqual(['a'])
  })
})


// ── computeHarnessSummaries ───────────────────────────────────────────────────

describe('computeHarnessSummaries', () => {
  function makeAppData(overrides: Partial<import('@agentistics/core').AppData> = {}): import('@agentistics/core').AppData {
    return {
      statsCache: {
        version: 1,
        lastComputedDate: '2026-06-10',
        dailyActivity: [
          { date: '2026-06-08', sessionCount: 5, messageCount: 20, toolCallCount: 30 },
          { date: '2026-06-09', sessionCount: 3, messageCount: 12, toolCallCount: 15 },
        ],
        dailyModelTokens: [],
        modelUsage: {
          'claude-sonnet-4-5': {
            inputTokens: 100_000,
            outputTokens: 20_000,
            cacheReadInputTokens: 5_000,
            cacheCreationInputTokens: 2_000,
            webSearchRequests: 0,
            costUSD: 0,
          },
        },
        totalSessions: 8,
        totalMessages: 32,
        longestSession: { sessionId: 'x', duration: 60, messageCount: 10, timestamp: '2026-06-09T10:00:00Z' },
        firstSessionDate: '2026-06-08',
        hourCounts: {},
        totalSpeculationTimeSavedMs: 0,
      },
      sessions: [
        // Claude session on a day ALREADY in statsCache — should NOT count as gap
        {
          session_id: 'c1',
          harness: 'claude',
          start_time: '2026-06-09T10:00:00Z',
          user_message_count: 3,
          assistant_message_count: 3,
          input_tokens: 500,
          output_tokens: 200,
          project_path: '/p',
          duration_minutes: 5,
          tool_counts: {},
          tool_output_tokens: {},
          agent_file_reads: {},
          languages: [],
          git_commits: 0,
          git_pushes: 0,
          first_prompt: '',
          user_interruptions: 0,
          user_response_times: [],
          tool_errors: 0,
          tool_error_categories: {},
          uses_task_agent: false,
          uses_mcp: false,
          uses_web_search: false,
          uses_web_fetch: false,
          lines_added: 0,
          lines_removed: 0,
          files_modified: 0,
          message_hours: [],
          user_message_timestamps: [],
        },
        // Claude session on a GAP day (not in statsCache) — should count
        {
          session_id: 'c2',
          harness: 'claude',
          start_time: '2026-06-10T10:00:00Z',
          user_message_count: 4,
          assistant_message_count: 4,
          input_tokens: 800,
          output_tokens: 300,
          project_path: '/p',
          duration_minutes: 7,
          tool_counts: {},
          tool_output_tokens: {},
          agent_file_reads: {},
          languages: [],
          git_commits: 0,
          git_pushes: 0,
          first_prompt: '',
          user_interruptions: 0,
          user_response_times: [],
          tool_errors: 0,
          tool_error_categories: {},
          uses_task_agent: false,
          uses_mcp: false,
          uses_web_search: false,
          uses_web_fetch: false,
          lines_added: 0,
          lines_removed: 0,
          files_modified: 0,
          message_hours: [],
          user_message_timestamps: [],
        },
        // Codex sessions
        {
          session_id: 'x1',
          harness: 'codex',
          start_time: '2026-06-10T08:00:00Z',
          user_message_count: 2,
          assistant_message_count: 2,
          input_tokens: 1000,
          output_tokens: 400,
          model: 'gpt-4o',
          project_path: '/q',
          duration_minutes: 3,
          tool_counts: {},
          tool_output_tokens: {},
          agent_file_reads: {},
          languages: [],
          git_commits: 0,
          git_pushes: 0,
          first_prompt: '',
          user_interruptions: 0,
          user_response_times: [],
          tool_errors: 0,
          tool_error_categories: {},
          uses_task_agent: false,
          uses_mcp: false,
          uses_web_search: false,
          uses_web_fetch: false,
          lines_added: 0,
          lines_removed: 0,
          files_modified: 0,
          message_hours: [],
          user_message_timestamps: [],
        },
        {
          session_id: 'x2',
          harness: 'codex',
          start_time: '2026-06-11T09:00:00Z',
          user_message_count: 1,
          assistant_message_count: 1,
          input_tokens: 500,
          output_tokens: 200,
          model: 'gpt-4o',
          project_path: '/q',
          duration_minutes: 2,
          tool_counts: {},
          tool_output_tokens: {},
          agent_file_reads: {},
          languages: [],
          git_commits: 0,
          git_pushes: 0,
          first_prompt: '',
          user_interruptions: 0,
          user_response_times: [],
          tool_errors: 0,
          tool_error_categories: {},
          uses_task_agent: false,
          uses_mcp: false,
          uses_web_search: false,
          uses_web_fetch: false,
          lines_added: 0,
          lines_removed: 0,
          files_modified: 0,
          message_hours: [],
          user_message_timestamps: [],
        },
      ] as import('@agentistics/core').SessionMeta[],
      projects: [],
      allSessions: [],
      harnesses: ['claude', 'codex'],
      ...overrides,
    }
  }

  test('claude sessions come from statsCache sum + gap days (not raw session count)', () => {
    const data = makeAppData()
    const summaries = computeHarnessSummaries(data)

    // statsCache has 5+3=8 sessions. Gap day (2026-06-10) adds 1 more.
    // Raw data.sessions has 2 claude sessions — must NOT use that number.
    expect(summaries['claude'].sessions).toBe(9)
  })

  test('claude sessions does not double-count statsCache days', () => {
    const data = makeAppData()
    const summaries = computeHarnessSummaries(data)

    // Session c1 is on 2026-06-09, which IS in statsCache — should not add 1
    // Session c2 is on 2026-06-10, which is NOT in statsCache — should add 1
    // So: 8 (statsCache base) + 1 (gap) = 9
    expect(summaries['claude'].sessions).toBe(9)
  })

  test('codex sessions uses per-session count', () => {
    const data = makeAppData()
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex'].sessions).toBe(2)
  })

  test('codex messages are summed correctly', () => {
    const data = makeAppData()
    const summaries = computeHarnessSummaries(data)
    // x1: 2+2=4, x2: 1+1=2 → total 6
    expect(summaries['codex'].messages).toBe(6)
  })

  test('claude tokens come from statsCache.modelUsage', () => {
    const data = makeAppData()
    const summaries = computeHarnessSummaries(data)
    expect(summaries['claude'].inputTokens).toBe(100_000)
    expect(summaries['claude'].outputTokens).toBe(20_000)
  })

  test('only harnesses in data.harnesses appear in result', () => {
    const data = makeAppData({ harnesses: ['claude'] })
    const summaries = computeHarnessSummaries(data)
    expect('claude' in summaries).toBe(true)
    expect('codex' in summaries).toBe(false)
  })

  test('claude costUSD uses calcCost on statsCache.modelUsage (no inline math)', () => {
    const data = makeAppData()
    const summaries = computeHarnessSummaries(data)
    // Just assert it's a positive number — the exact value depends on model pricing
    expect(summaries['claude'].costUSD).toBeGreaterThan(0)
  })
})