import { describe, test, expect } from 'bun:test'
import { calcStreak, calcLongestStreak, getDateRangeFilter, filterByHarness, computeHarnessSummaries, computeFilteredHarnessSummaries, sortRepos, pickLongestSession, repositoryGitTotals, apportionModelUsage, summarizeApiCostByDay } from './useData'
import { mergeStatsCaches } from '@agentistics/core'
import type { RepoSortKey, RepoStat } from './useData'
import type { SessionMeta } from '@agentistics/core'
import { format, subDays } from 'date-fns'

// calcStreak

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

// calcLongestStreak

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

// getDateRangeFilter

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

  test('"all" com datas customizadas → usa as datas fornecidas (dia calendário em UTC)', () => {
    // UTC, não fuso local — ver o comentário em getDateRangeFilter: precisa bater com sessionDay(),
    // que fatia a string ISO crua (`.slice(0, 10)`, sempre UTC).
    const { start, end } = getDateRangeFilter('all', '2026-01-01', '2026-03-31')
    expect(start.getUTCFullYear()).toBe(2026)
    expect(start.getUTCMonth()).toBe(0) // janeiro
    expect(start.getUTCDate()).toBe(1)
    expect(start.getUTCHours()).toBe(0)
    expect(end.getUTCMonth()).toBe(2)   // março
    expect(end.getUTCDate()).toBe(31)
    expect(end.getUTCHours()).toBe(23)
  })

  test('customStart sem customEnd → end é agora', () => {
    const { start, end } = getDateRangeFilter('all', '2025-01-01')
    expect(start.getUTCFullYear()).toBe(2025)
    expect(end.getTime()).toBeGreaterThan(Date.now() - 1000)
  })

  test('um dia customizado (start === end) cobre exatamente esse dia calendário UTC', () => {
    const { start, end } = getDateRangeFilter('all', '2026-07-23', '2026-07-23')
    expect(start.toISOString()).toBe('2026-07-23T00:00:00.000Z')
    expect(end.toISOString()).toBe('2026-07-23T23:59:59.999Z')
  })

  test('start sempre antes de end', () => {
    for (const range of ['7d', '30d', '90d', 'all'] as const) {
      const { start, end } = getDateRangeFilter(range)
      expect(start.getTime()).toBeLessThan(end.getTime())
    }
  })
})

// filterByHarness

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


// computeHarnessSummaries

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

// computeHarnessSummaries — new fields (hour/dow/activity/peaks)

describe('computeHarnessSummaries — hourCounts and peakHour', () => {
  function makeSession(overrides: Partial<import('@agentistics/core').SessionMeta>): import('@agentistics/core').SessionMeta {
    return {
      session_id: 'test',
      harness: 'codex',
      project_path: '/p',
      start_time: '2026-06-10T08:00:00Z',
      end_time: undefined,
      duration_minutes: 5,
      user_message_count: 1,
      assistant_message_count: 1,
      tool_counts: {},
      tool_output_tokens: {},
      agent_file_reads: {},
      languages: [],
      git_commits: 0,
      git_pushes: 0,
      input_tokens: 1000,
      output_tokens: 400,
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
      model: 'gpt-4o',
      ...overrides,
    }
  }

  function makeData(sessions: import('@agentistics/core').SessionMeta[]): import('@agentistics/core').AppData {
    return {
      statsCache: {
        version: 1,
        lastComputedDate: '2026-06-10',
        dailyActivity: [],
        dailyModelTokens: [],
        modelUsage: {},
        totalSessions: 0,
        totalMessages: 0,
        longestSession: { sessionId: 'x', duration: 0, messageCount: 0, timestamp: '2026-06-10T00:00:00Z' },
        firstSessionDate: '2026-06-10',
        hourCounts: {},
        totalSpeculationTimeSavedMs: 0,
      },
      sessions,
      projects: [],
      allSessions: [],
      harnesses: ['codex'],
    }
  }

  test('codex: hourCounts sums message_hours across sessions', () => {
    const s1 = makeSession({ session_id: 's1', message_hours: [9, 9, 14] })
    const s2 = makeSession({ session_id: 's2', message_hours: [9, 22] })
    const data = makeData([s1, s2])
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.hourCounts[9]).toBe(3)  // 9 appears 3 times
    expect(summaries['codex']!.hourCounts[14]).toBe(1)
    expect(summaries['codex']!.hourCounts[22]).toBe(1)
    expect(summaries['codex']!.hourCounts[0]).toBe(0)
  })

  test('codex: peakHour identifies hour with highest count', () => {
    const s1 = makeSession({ session_id: 's1', message_hours: [9, 9, 14] })
    const data = makeData([s1])
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.peakHour).toBe(9)
  })

  test('codex: peakHour is null when no message_hours data', () => {
    const s1 = makeSession({ session_id: 's1', message_hours: [] })
    const data = makeData([s1])
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.peakHour).toBeNull()
  })

  test('codex: hourCounts has exactly 24 entries', () => {
    const s1 = makeSession({ session_id: 's1', message_hours: [0, 23] })
    const data = makeData([s1])
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.hourCounts.length).toBe(24)
  })
})

describe('computeHarnessSummaries — dowCounts and peakDow', () => {
  function makeSession(id: string, startTime: string, hours: number[] = []): import('@agentistics/core').SessionMeta {
    return {
      session_id: id,
      harness: 'codex',
      project_path: '/p',
      start_time: startTime,
      duration_minutes: 5,
      user_message_count: 1,
      assistant_message_count: 1,
      tool_counts: {},
      tool_output_tokens: {},
      agent_file_reads: {},
      languages: [],
      git_commits: 0,
      git_pushes: 0,
      input_tokens: 100,
      output_tokens: 50,
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
      message_hours: hours,
      user_message_timestamps: [],
      model: 'gpt-4o',
    }
  }

  function makeData(sessions: import('@agentistics/core').SessionMeta[]): import('@agentistics/core').AppData {
    return {
      statsCache: {
        version: 1,
        lastComputedDate: '2026-06-14',
        dailyActivity: [],
        dailyModelTokens: [],
        modelUsage: {},
        totalSessions: 0,
        totalMessages: 0,
        longestSession: { sessionId: 'x', duration: 0, messageCount: 0, timestamp: '2026-06-10T00:00:00Z' },
        firstSessionDate: '2026-06-10',
        hourCounts: {},
        totalSpeculationTimeSavedMs: 0,
      },
      sessions,
      projects: [],
      allSessions: [],
      harnesses: ['codex'],
    }
  }

  test('codex: dowCounts maps Monday session to index 1', () => {
    // 2026-06-08 is a Monday (dow=1)
    const s = makeSession('s1', '2026-06-08T09:00:00Z')
    const data = makeData([s])
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.dowCounts[1]).toBe(1)   // Monday
    expect(summaries['codex']!.dowCounts[0]).toBe(0)   // Sunday
  })

  test('codex: peakDow identifies day with most sessions', () => {
    // 2026-06-08 = Monday (1), 2026-06-09 = Tuesday (2) x2
    const sessions = [
      makeSession('s1', '2026-06-08T09:00:00Z'),
      makeSession('s2', '2026-06-09T10:00:00Z'),
      makeSession('s3', '2026-06-09T14:00:00Z'),
    ]
    const data = makeData(sessions)
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.peakDow).toBe(2)   // Tuesday
    expect(summaries['codex']!.dowCounts[2]).toBe(2)
    expect(summaries['codex']!.dowCounts[1]).toBe(1)
  })

  test('codex: dowCounts has exactly 7 entries', () => {
    const s = makeSession('s1', '2026-06-08T09:00:00Z')
    const data = makeData([s])
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.dowCounts.length).toBe(7)
  })

  // Real-world trap: a harness adapter can write start_time/end_time as an epoch NUMBER instead
  // of a string (found live — the Kimi adapter's `updatedAt`). `!!s.start_time` alone is not
  // enough to guard against this since a nonzero number is truthy; parseISO() then throws
  // ("e.split is not a function") deep inside date-fns and takes the whole render down with it.
  test('a session with a numeric start_time does not throw', () => {
    const s = makeSession('s1', '2026-06-08T09:00:00Z')
    const malformed = { ...s, start_time: 1785939883717 as unknown as string }
    const data = makeData([s, malformed])
    expect(() => computeHarnessSummaries(data)).not.toThrow()
    const summaries = computeHarnessSummaries(data)
    // Only the well-formed session is counted into dowCounts; the malformed one is skipped.
    expect(summaries['codex']!.dowCounts[1]).toBe(1)
  })
})

describe('computeHarnessSummaries — peakTokenDay and peakSessionCost', () => {
  function makeSession(
    id: string,
    startTime: string,
    input: number,
    output: number,
    model = 'gpt-4o',
  ): import('@agentistics/core').SessionMeta {
    return {
      session_id: id,
      harness: 'codex',
      project_path: '/p',
      start_time: startTime,
      duration_minutes: 5,
      user_message_count: 1,
      assistant_message_count: 1,
      tool_counts: {},
      tool_output_tokens: {},
      agent_file_reads: {},
      languages: [],
      git_commits: 0,
      git_pushes: 0,
      input_tokens: input,
      output_tokens: output,
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
      model,
    }
  }

  function makeData(sessions: import('@agentistics/core').SessionMeta[]): import('@agentistics/core').AppData {
    return {
      statsCache: {
        version: 1,
        lastComputedDate: '2026-06-14',
        dailyActivity: [],
        dailyModelTokens: [],
        modelUsage: {},
        totalSessions: 0,
        totalMessages: 0,
        longestSession: { sessionId: 'x', duration: 0, messageCount: 0, timestamp: '2026-06-10T00:00:00Z' },
        firstSessionDate: '2026-06-10',
        hourCounts: {},
        totalSpeculationTimeSavedMs: 0,
      },
      sessions,
      projects: [],
      allSessions: [],
      harnesses: ['codex'],
    }
  }

  test('codex: peakTokenDay identifies the day with highest total tokens', () => {
    // 2026-06-10: 1000+400=1400 tokens; 2026-06-11: 500+200=700 tokens
    const sessions = [
      makeSession('s1', '2026-06-10T08:00:00Z', 1000, 400),
      makeSession('s2', '2026-06-11T09:00:00Z', 500, 200),
    ]
    const data = makeData(sessions)
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.peakTokenDay?.date).toBe('2026-06-10')
    expect(summaries['codex']!.peakTokenDay?.tokens).toBe(1400)
  })

  test('codex: peakTokenDay aggregates multiple sessions on same day', () => {
    // Both sessions on 2026-06-10: 1000+400 + 500+200 = 2100
    const sessions = [
      makeSession('s1', '2026-06-10T08:00:00Z', 1000, 400),
      makeSession('s2', '2026-06-10T14:00:00Z', 500, 200),
    ]
    const data = makeData(sessions)
    const summaries = computeHarnessSummaries(data)
    expect(summaries['codex']!.peakTokenDay?.date).toBe('2026-06-10')
    expect(summaries['codex']!.peakTokenDay?.tokens).toBe(2100)
  })

  test('gemini: peakTokenDay is null when sessions have 0 tokens (capability enabled but no data)', () => {
    const sessions = [
      { ...makeSession('s1', '2026-06-10T08:00:00Z', 0, 0), harness: 'gemini' as const, model: undefined },
    ]
    const data = { ...makeData([]), sessions, harnesses: ['gemini'] as import('@agentistics/core').HarnessId[] }
    const summaries = computeHarnessSummaries(data)
    // gemini has tokens=true but the fixture has 0 tokens — peakTokenDay requires tokens > 0
    expect(summaries['gemini']!.peakTokenDay).toBeNull()
  })

  test('codex: peakSessionCost uses calcCost (not inline math)', () => {
    // s1 has more tokens → higher cost
    const sessions = [
      makeSession('s1', '2026-06-10T08:00:00Z', 10_000, 2_000),
      makeSession('s2', '2026-06-11T09:00:00Z', 500, 100),
    ]
    const data = makeData(sessions)
    const summaries = computeHarnessSummaries(data)
    // peakSessionCost should be positive and correspond to s1
    expect(summaries['codex']!.peakSessionCost).toBeGreaterThan(0)
    // s2 cost should be smaller — verify indirectly that peak > s2 cost
    const { calcCost: cc } = require('@agentistics/core')
    const s2Cost = cc({ inputTokens: 500, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0 }, 'gpt-4o')
    expect(summaries['codex']!.peakSessionCost).toBeGreaterThan(s2Cost)
  })

  test('gemini: peakSessionCost is null when sessions have no model (capability enabled but model unknown)', () => {
    const sessions = [
      { ...makeSession('s1', '2026-06-10T08:00:00Z', 0, 0), harness: 'gemini' as const, model: undefined },
    ]
    const data = { ...makeData([]), sessions, harnesses: ['gemini'] as import('@agentistics/core').HarnessId[] }
    const summaries = computeHarnessSummaries(data)
    // gemini has cost=true but cost is only computed when s.model is set; no model → null
    expect(summaries['gemini']!.peakSessionCost).toBeNull()
  })

  test('claude: peakSessionCost is always null (statsCache has no per-session breakdown)', () => {
    const data: import('@agentistics/core').AppData = {
      statsCache: {
        version: 1,
        lastComputedDate: '2026-06-10',
        dailyActivity: [{ date: '2026-06-10', sessionCount: 2, messageCount: 4, toolCallCount: 0 }],
        dailyModelTokens: [],
        modelUsage: { 'claude-sonnet-4-5': { inputTokens: 10000, outputTokens: 2000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0 } },
        totalSessions: 2,
        totalMessages: 4,
        longestSession: { sessionId: 'x', duration: 0, messageCount: 0, timestamp: '2026-06-10T00:00:00Z' },
        firstSessionDate: '2026-06-10',
        hourCounts: {},
        totalSpeculationTimeSavedMs: 0,
      },
      sessions: [],
      projects: [],
      allSessions: [],
      harnesses: ['claude'],
    }
    const summaries = computeHarnessSummaries(data)
    expect(summaries['claude']!.peakSessionCost).toBeNull()
  })
})

describe('computeHarnessSummaries — dailyActivity', () => {
  test('codex: dailyActivity groups sessions by day and sorts ascending', () => {
    function s(id: string, day: string): import('@agentistics/core').SessionMeta {
      return {
        session_id: id,
        harness: 'codex',
        project_path: '/p',
        start_time: `${day}T08:00:00Z`,
        duration_minutes: 5,
        user_message_count: 1,
        assistant_message_count: 1,
        tool_counts: {},
        tool_output_tokens: {},
        agent_file_reads: {},
        languages: [],
        git_commits: 0,
        git_pushes: 0,
        input_tokens: 100,
        output_tokens: 50,
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
        model: 'gpt-4o',
      }
    }
    const data: import('@agentistics/core').AppData = {
      statsCache: {
        version: 1,
        lastComputedDate: '2026-06-12',
        dailyActivity: [],
        dailyModelTokens: [],
        modelUsage: {},
        totalSessions: 0,
        totalMessages: 0,
        longestSession: { sessionId: 'x', duration: 0, messageCount: 0, timestamp: '2026-06-10T00:00:00Z' },
        firstSessionDate: '2026-06-10',
        hourCounts: {},
        totalSpeculationTimeSavedMs: 0,
      },
      sessions: [
        s('a', '2026-06-12'),
        s('b', '2026-06-10'),
        s('c', '2026-06-10'),  // same day as b
        s('d', '2026-06-11'),
      ],
      projects: [],
      allSessions: [],
      harnesses: ['codex'],
    }
    const summaries = computeHarnessSummaries(data)
    const daily = summaries['codex']!.dailyActivity
    // Should be sorted ascending
    expect(daily[0]!.date).toBe('2026-06-10')
    expect(daily[1]!.date).toBe('2026-06-11')
    expect(daily[2]!.date).toBe('2026-06-12')
    // 2026-06-10 has 2 sessions
    expect(daily[0]!.sessions).toBe(2)
    expect(daily[1]!.sessions).toBe(1)
    expect(daily[2]!.sessions).toBe(1)
  })

  test('claude: a dailyActivity entry with no date does not throw and is skipped', () => {
    const data: import('@agentistics/core').AppData = {
      statsCache: {
        version: 1,
        lastComputedDate: '2026-06-12',
        dailyActivity: [
          { date: '2026-06-10', messageCount: 4, sessionCount: 1, toolCallCount: 2 },
          // Malformed entry — no `date`. Must be skipped, never crash parseISO/localeCompare.
          { date: undefined as unknown as string, messageCount: 3, sessionCount: 1, toolCallCount: 1 },
        ],
        dailyModelTokens: [],
        modelUsage: {},
        totalSessions: 2,
        totalMessages: 7,
        longestSession: { sessionId: 'x', duration: 0, messageCount: 0, timestamp: '2026-06-10T00:00:00Z' },
        firstSessionDate: '2026-06-10',
        hourCounts: {},
        totalSpeculationTimeSavedMs: 0,
      },
      sessions: [],
      projects: [],
      allSessions: [],
      harnesses: ['claude'],
    }
    expect(() => computeHarnessSummaries(data)).not.toThrow()
    const summaries = computeHarnessSummaries(data)
    const daily = summaries['claude']!.dailyActivity
    expect(daily.map(d => d.date)).toEqual(['2026-06-10'])
  })
})

// computeHarnessSummaries — models[] and costPerMTokens

describe('computeHarnessSummaries — models[] and costPerMTokens', () => {
  function makeSession(
    id: string,
    input: number,
    output: number,
    model: string | undefined = 'gpt-4o',
  ): import('@agentistics/core').SessionMeta {
    return {
      session_id: id,
      harness: 'codex',
      project_path: '/p',
      start_time: '2026-06-10T08:00:00Z',
      duration_minutes: 5,
      user_message_count: 1,
      assistant_message_count: 1,
      tool_counts: {},
      tool_output_tokens: {},
      agent_file_reads: {},
      languages: [],
      git_commits: 0,
      git_pushes: 0,
      input_tokens: input,
      output_tokens: output,
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
      model,
    }
  }

  function makeData(sessions: import('@agentistics/core').SessionMeta[]): import('@agentistics/core').AppData {
    return {
      statsCache: {
        version: 1,
        lastComputedDate: '2026-06-14',
        dailyActivity: [],
        dailyModelTokens: [],
        modelUsage: {},
        totalSessions: 0,
        totalMessages: 0,
        longestSession: { sessionId: 'x', duration: 0, messageCount: 0, timestamp: '2026-06-10T00:00:00Z' },
        firstSessionDate: '2026-06-10',
        hourCounts: {},
        totalSpeculationTimeSavedMs: 0,
      },
      sessions,
      projects: [],
      allSessions: [],
      harnesses: ['codex'],
    }
  }

  test('codex: models[] groups sessions by model and sums tokens', () => {
    const sessions = [
      makeSession('s1', 1000, 400, 'gpt-4o'),
      makeSession('s2', 500, 200, 'gpt-4o'),
    ]
    const summaries = computeHarnessSummaries(makeData(sessions))
    const models = summaries['codex']!.models
    expect(models.length).toBe(1)
    expect(models[0]!.model).toBe('gpt-4o')
    expect(models[0]!.inputTokens).toBe(1500)
    expect(models[0]!.outputTokens).toBe(600)
    expect(models[0]!.costUSD).toBeGreaterThan(0)
  })

  test('codex: models[] sorted by costUSD descending', () => {
    const sessions = [
      makeSession('s1', 100, 50, 'gpt-4o-mini'),
      makeSession('s2', 100_000, 50_000, 'gpt-4o'),
    ]
    const summaries = computeHarnessSummaries(makeData(sessions))
    const models = summaries['codex']!.models
    expect(models.length).toBe(2)
    // gpt-4o has far more tokens → higher cost → first
    expect(models[0]!.model).toBe('gpt-4o')
    expect(models[0]!.costUSD).toBeGreaterThanOrEqual(models[1]!.costUSD)
  })

  test('codex: sessions without model are excluded from models[] but aggregate totals are unchanged', () => {
    const sessions = [
      { ...makeSession('s1', 1000, 400), model: undefined },  // no model — excluded from models[]
      makeSession('s2', 500, 200, 'gpt-4o'),                  // known model — included
    ]
    const summaries = computeHarnessSummaries(makeData(sessions))
    const s = summaries['codex']!

    // models[] must not contain empty or 'unknown' entries
    expect(s.models.every(m => m.model && m.model !== 'unknown')).toBe(true)
    // only the session with a known model appears
    expect(s.models.length).toBe(1)
    expect(s.models[0]!.model).toBe('gpt-4o')

    // aggregate totals include BOTH sessions (unknown-model session still counts)
    expect(s.sessions).toBe(2)
    expect(s.inputTokens).toBe(1500)
    expect(s.outputTokens).toBe(600)
  })

  test('codex: costPerMTokens equals costUSD / ((input+output)/1e6)', () => {
    const sessions = [makeSession('s1', 1_000_000, 0, 'gpt-4o')]
    const summaries = computeHarnessSummaries(makeData(sessions))
    const s = summaries['codex']!
    const expected = s.costUSD / ((s.inputTokens + s.outputTokens) / 1e6)
    expect(s.costPerMTokens).toBeCloseTo(expected, 6)
  })

  test('codex: costPerMTokens is null when there are 0 tokens', () => {
    const sessions = [makeSession('s1', 0, 0, 'gpt-4o')]
    const summaries = computeHarnessSummaries(makeData(sessions))
    expect(summaries['codex']!.costPerMTokens).toBeNull()
  })

  test('claude: models[] derived from statsCache.modelUsage via calcCost', () => {
    const data: import('@agentistics/core').AppData = {
      statsCache: {
        version: 1,
        lastComputedDate: '2026-06-10',
        dailyActivity: [{ date: '2026-06-10', sessionCount: 1, messageCount: 2, toolCallCount: 0 }],
        dailyModelTokens: [],
        modelUsage: {
          'claude-sonnet-4-5': { inputTokens: 100_000, outputTokens: 20_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0 },
        },
        totalSessions: 1,
        totalMessages: 2,
        longestSession: { sessionId: 'x', duration: 0, messageCount: 0, timestamp: '2026-06-10T00:00:00Z' },
        firstSessionDate: '2026-06-10',
        hourCounts: {},
        totalSpeculationTimeSavedMs: 0,
      },
      sessions: [],
      projects: [],
      allSessions: [],
      harnesses: ['claude'],
    }
    const summaries = computeHarnessSummaries(data)
    const c = summaries['claude']!
    expect(c.models.length).toBe(1)
    expect(c.models[0]!.model).toBe('claude-sonnet-4-5')
    expect(c.models[0]!.inputTokens).toBe(100_000)
    expect(c.models[0]!.costUSD).toBeGreaterThan(0)
    expect(c.costPerMTokens).toBeGreaterThan(0)
  })
})

// sortRepos

function repo(p: Partial<RepoStat>): RepoStat {
  return {
    id: 'x', remote: '', linked: true, name: 'x', path: '', sessions: 0, messages: 0, tools: 0,
    costUSD: 0, inputTokens: 0, outputTokens: 0, gitCommits: 0, linesAdded: 0, linesRemoved: 0,
    filesModified: 0, ciSessions: 0, members: [], harnesses: ['claude'], firstActive: '', lastActive: '',
    activityByDay: {}, _users: new Set(), _harnesses: new Set(), _paths: {}, ...p,
  }
}

test('sortRepos by cost descending then ascending', () => {
  const repos = [repo({ id: 'a', costUSD: 5 }), repo({ id: 'b', costUSD: 10 }), repo({ id: 'c', costUSD: 3 })]
  expect(sortRepos(repos, 'cost', 'desc').map(r => r.id)).toEqual(['b', 'a', 'c'])
  expect(sortRepos(repos, 'cost', 'asc').map(r => r.id)).toEqual(['c', 'a', 'b'])
})

test('sortRepos by name uses locale compare', () => {
  const repos = [repo({ id: 'a', name: 'zeta' }), repo({ id: 'b', name: 'alpha' })]
  expect(sortRepos(repos, 'name', 'asc').map(r => r.name)).toEqual(['alpha', 'zeta'])
})

test('sortRepos does not mutate the input array', () => {
  const repos = [repo({ id: 'a', costUSD: 1 }), repo({ id: 'b', costUSD: 2 })]
  sortRepos(repos, 'cost', 'desc')
  expect(repos.map(r => r.id)).toEqual(['a', 'b'])
})
// computeFilteredHarnessSummaries — machine/team scope must equal the member scope

describe('machine filter reads the same deep history as the member filter', () => {
  // Regression: `userStatsCaches` is keyed by display name and SUMS a member's machines, so a
  // machine (or team) selection could not be served from it and fell back to summing the
  // individual session docs — which only cover the sessions still stored one-by-one. The same
  // scope reported a fraction of the member view (835 sessions vs 225 on real data).
  const day = (date: string, sessionCount: number, messageCount: number) =>
    ({ date, sessionCount, messageCount, toolCallCount: 0 })
  const usage = (input: number, output: number) => ({
    'claude-sonnet-4-5': {
      inputTokens: input, outputTokens: output,
      cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0,
    },
  })
  const cacheFor = (dates: [string, number, number][], input: number, output: number): import('@agentistics/core').StatsCache => ({
    version: 1,
    lastComputedDate: dates[dates.length - 1]![0],
    dailyActivity: dates.map(([d, s, m]) => day(d, s, m)),
    dailyModelTokens: [],
    modelUsage: usage(input, output),
    totalSessions: dates.reduce((a, [, s]) => a + s, 0),
    totalMessages: dates.reduce((a, [, , m]) => a + m, 0),
    longestSession: { sessionId: 'x', duration: 1, messageCount: 1, timestamp: '2026-06-01T00:00:00Z' },
    firstSessionDate: dates[0]![0],
    hourCounts: {},
    totalSpeculationTimeSavedMs: 0,
  })

  const alienware = cacheFor([['2026-06-01', 400, 1200], ['2026-06-02', 100, 300]], 8_000_000, 50_000_000)
  const dell = cacheFor([['2026-06-01', 200, 600], ['2026-06-03', 135, 400]], 8_350_000, 53_000_000)

  const data = {
    statsCache: cacheFor([['2026-06-01', 1, 1]], 0, 0),
    sessions: [],   // the deep history exists ONLY aggregated — the session docs are long gone
    projects: [],
    allSessions: [],
    harnesses: ['claude'],
    userStatsCaches: { 'Bryan Soares': mergeStatsCaches([alienware, dell]) },
    machineStatsCaches: { alienware, dell },
    machineOwners: {
      alienware: { user: 'Bryan Soares', teamIds: ['dev'] },
      dell: { user: 'Bryan Soares', teamIds: ['dev'] },
    },
  } as unknown as import('@agentistics/core').AppData

  const filters = (over: Partial<import('@agentistics/core').Filters>): import('@agentistics/core').Filters =>
    ({ dateRange: 'all', customStart: '', customEnd: '', projects: [], models: [], ...over })

  const byMember = computeFilteredHarnessSummaries(data, filters({ users: ['Bryan Soares'] }))
  const byMachines = computeFilteredHarnessSummaries(data, filters({ machines: ['alienware', 'dell'] }))
  const byTeam = computeFilteredHarnessSummaries(data, filters({ teams: ['dev'] }))

  test('selecting both of a member\'s machines equals selecting the member', () => {
    expect(byMachines.summaries.claude).toEqual(byMember.summaries.claude)
    expect(byMachines.summaries.claude!.sessions).toBe(835)
  })

  test('the team holding only those machines equals the same scope', () => {
    expect(byTeam.summaries.claude).toEqual(byMember.summaries.claude)
  })

  test('a single machine reports its own history, not the member\'s total', () => {
    const one = computeFilteredHarnessSummaries(data, filters({ machines: ['alienware'] }))
    expect(one.summaries.claude!.sessions).toBe(500)
    expect(one.summaries.claude!.inputTokens).toBe(8_000_000)
  })

  test('falls back to the per-session sum when a machine has no cache (never a partial sum)', () => {
    const partial = { ...data, machineStatsCaches: { alienware } } as import('@agentistics/core').AppData
    const out = computeFilteredHarnessSummaries(partial, filters({ machines: ['alienware', 'dell'] }))
    expect(out.summaries.claude!.sessions).toBe(0)  // no session docs → old behaviour, unchanged
  })

  // Regression: a scoped principal (a manager) receives `machineOwners` / `userStatsCaches` pruned
  // to what they may see. A selection that resolves to NO cache used to merge an EMPTY cache and
  // report a confident 0 on every KPI, instead of falling back to the per-session sum. The session
  // here is deliberately visible so a correct fallback is non-zero and the zero is unmistakable.
  const scoped = {
    ...data,
    sessions: [{
      session_id: 's1', harness: 'claude', user: 'Bryan Soares', memberId: 'alienware',
      teamIds: ['dev'], project_path: '/p', start_time: '2026-06-01T10:00:00.000Z',
      input_tokens: 10, output_tokens: 20, user_message_count: 1, assistant_message_count: 1,
    }],
  } as unknown as import('@agentistics/core').AppData

  test('a team the viewer holds no machine for falls back to sessions, not a confident zero', () => {
    const out = computeFilteredHarnessSummaries(scoped, filters({ teams: ['finance'] }))
    expect(out.summaries.claude?.sessions ?? 0).toBe(0) // no session is in `finance` — a true zero
    // …but the team the viewer CAN see must not be zeroed just because the pruned map lacks it.
    const blind = { ...scoped, machineOwners: {}, machineStatsCaches: {} } as import('@agentistics/core').AppData
    const seen = computeFilteredHarnessSummaries(blind, filters({ teams: ['dev'] }))
    expect(seen.summaries.claude!.sessions).toBe(1)
    expect(seen.summaries.claude!.inputTokens).toBe(10)
  })

  test('a member whose cache was pruned away falls back to sessions, not a confident zero', () => {
    // `userStatsCaches` holds another member only — the selected one was pruned out for this viewer.
    const pruned = {
      ...scoped,
      userStatsCaches: { 'Someone Else': alienware },
      machineOwners: {}, machineStatsCaches: {},
    } as unknown as import('@agentistics/core').AppData
    const out = computeFilteredHarnessSummaries(pruned, filters({ users: ['Bryan Soares'] }))
    expect(out.summaries.claude!.sessions).toBe(1)
    expect(out.summaries.claude!.inputTokens).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// pickLongestSession — the "958h" regression
// ---------------------------------------------------------------------------

function sess(id: string, wallMin: number, activeMin?: number): SessionMeta {
  return {
    session_id: id, project_path: '/p', start_time: '2026-01-01T00:00:00Z',
    duration_minutes: wallMin, active_minutes: activeMin,
    user_message_count: 1, assistant_message_count: 1,
    tool_counts: {}, tool_output_tokens: {}, agent_file_reads: {}, languages: [],
    git_commits: 0, git_pushes: 0, input_tokens: 0, output_tokens: 0,
    first_prompt: '', user_interruptions: 0, user_response_times: [],
    tool_errors: 0, tool_error_categories: {}, uses_task_agent: false,
    uses_mcp: false, uses_web_search: false, uses_web_fetch: false,
    lines_added: 0, lines_removed: 0, files_modified: 0,
    message_hours: [], user_message_timestamps: [], harness: 'claude',
  }
}

describe('pickLongestSession', () => {
  test('a deleted-transcript session does not win on its wall clock', () => {
    // The real case: 958h of wall clock, transcript already cleaned up, so no active time.
    // It must lose to a shorter session that actually has measured work.
    const deleted = sess('deleted', 958 * 60, undefined)
    const real = sess('real', 106 * 60, 88 * 60)
    const { session, unmeasured } = pickLongestSession([deleted, real])
    expect(session?.session_id).toBe('real')
    expect(unmeasured).toBe(1)
  })

  test('ranks by active time, not by wall clock', () => {
    const openLong = sess('open-long', 500 * 60, 2 * 60)
    const workedMore = sess('worked-more', 10 * 60, 9 * 60)
    expect(pickLongestSession([openLong, workedMore]).session?.session_id).toBe('worked-more')
  })

  test('falls back to wall clock only when NOTHING has active time', () => {
    const a = sess('a', 100, undefined)
    const b = sess('b', 300, undefined)
    const { session, unmeasured } = pickLongestSession([a, b])
    expect(session?.session_id).toBe('b')
    // Not reported as unmeasured: the whole set is on the same (wall-clock) footing.
    expect(unmeasured).toBe(0)
  })

  test('empty input yields null, not a crash', () => {
    expect(pickLongestSession([]).session).toBeNull()
  })
})

describe('repositoryGitTotals', () => {
  const P = (path: string, commits: number) => ({
    path,
    git_stats: { commits, lines_added: commits * 10, lines_removed: commits, files_modified: commits * 2 },
  })

  test('sums every project when nothing narrows the scope', () => {
    expect(repositoryGitTotals([P('/a', 3), P('/b', 4)], null, false)?.commits).toBe(7)
  })

  test('sums only the scoped projects', () => {
    expect(repositoryGitTotals([P('/a', 3), P('/b', 4)], ['/b'], false)?.commits).toBe(4)
  })

  test('is UNDEFINED under a harness filter — a git log belongs to no harness', () => {
    expect(repositoryGitTotals([P('/a', 3)], null, true)).toBeUndefined()
  })

  test('is undefined, never zero, when no project in scope is a git repo', () => {
    expect(repositoryGitTotals([{ path: '/a' }], null, false)).toBeUndefined()
    expect(repositoryGitTotals([P('/a', 3)], ['/missing'], false)).toBeUndefined()
  })

  test('a project with no stats is skipped, not counted as zero', () => {
    expect(repositoryGitTotals([P('/a', 3), { path: '/b' }], null, false)?.commits).toBe(3)
  })
})

// apportionModelUsage — the one implementation of the daily-token split
describe('apportionModelUsage', () => {
  const global = {
    inputTokens: 500, outputTokens: 300, cacheReadInputTokens: 150, cacheCreationInputTokens: 50,
    webSearchRequests: 0, costUSD: 0,
  }

  test('splits a day total in the global proportions', () => {
    const out = apportionModelUsage(1000, global)
    expect(out).toMatchObject({ inputTokens: 500, outputTokens: 300, cacheReadInputTokens: 150, cacheCreationInputTokens: 50 })
  })

  test('conserves the token total it was given', () => {
    // The split is an approximation of the SHAPE, never of the volume — a day that loses tokens
    // here would quietly under-price itself against a plan.
    for (const total of [1000, 7777, 123_456]) {
      const out = apportionModelUsage(total, global)
      const sum = out.inputTokens + out.outputTokens + out.cacheReadInputTokens + out.cacheCreationInputTokens
      expect(Math.abs(sum - total)).toBeLessThanOrEqual(2) // rounding only
    }
  })

  test('with no global row it falls back to 70/30 and claims no cache', () => {
    // Inventing a cache split would move tokens onto the cheapest rate in the table and
    // understate the day.
    for (const g of [undefined, { ...global, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }]) {
      const out = apportionModelUsage(1000, g)
      expect(out).toMatchObject({ inputTokens: 700, outputTokens: 300, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 })
    }
  })

  test('zero tokens yields zeros, never NaN', () => {
    const out = apportionModelUsage(0, global)
    expect(out.inputTokens + out.outputTokens + out.cacheReadInputTokens + out.cacheCreationInputTokens).toBe(0)
  })
})

// summarizeApiCostByDay — the residue is a difference, never a reconciliation
describe('summarizeApiCostByDay', () => {
  const days = {
    claude: {
      '2026-04-02': { costUSD: 10, tokens: 1000, sessions: 2 },
      '2026-04-05': { costUSD: 15, tokens: 1500, sessions: 3 },
    },
    codex: {
      '2026-04-01': { costUSD: 5, tokens: 500, sessions: 1 },
    },
  }

  test('the invariant holds: sum of days + undated === the headline', () => {
    const out = summarizeApiCostByDay(days, 100, 10_000)
    const summed = Object.values(out.days).flatMap(d => Object.values(d ?? {})).reduce((s, e) => s + e.costUSD, 0)
    expect(summed + out.undatedCostUSD).toBeCloseTo(100, 9)
    expect(out.undatedCostUSD).toBeCloseTo(70, 9)
    expect(out.undatedTokens).toBe(7000)
  })

  test('a fully attributed total leaves no residue', () => {
    const out = summarizeApiCostByDay(days, 30, 3000)
    expect(out.undatedCostUSD).toBeCloseTo(0, 9)
    expect(out.undatedTokens).toBe(0)
  })

  test('firstDay and lastDay span every harness, not just one', () => {
    const out = summarizeApiCostByDay(days, 30, 3000)
    expect(out.firstDay).toBe('2026-04-01') // codex, earlier than any claude day
    expect(out.lastDay).toBe('2026-04-05')
  })

  test('no days at all: the whole total is undated and there is no window', () => {
    const out = summarizeApiCostByDay({}, 42, 900)
    expect(out.undatedCostUSD).toBe(42)
    expect(out.firstDay).toBeNull()
    expect(out.lastDay).toBeNull()
  })

  test('a negative residue is reported, not clamped away', () => {
    // The daily series reporting MORE than the cumulative total is the two local sources
    // contradicting each other. Hiding it behind a zero would let A exceed the total shown
    // beside it; the consumer withholds the plan basis on this instead.
    const out = summarizeApiCostByDay(days, 10, 1000)
    expect(out.undatedCostUSD).toBeCloseTo(-20, 9)
    expect(out.undatedTokens).toBe(-2000)
  })
})
