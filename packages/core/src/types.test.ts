import { describe, test, expect } from 'bun:test'
import { calcCost, getModelPrice, formatModel, getModelColor, formatProjectName, setHomeDir, HARNESS_CAPABILITIES, emptyStatsCache, mergeStatsCaches, normalizeGitRemote, repoShortName } from './types'
import type { ModelUsage, StatsCache } from './types'

describe('mergeStatsCaches', () => {
  function sc(over: Partial<StatsCache>): StatsCache {
    return { ...emptyStatsCache(), ...over }
  }

  test('empty input returns an empty statsCache', () => {
    const m = mergeStatsCaches([])
    expect(m.totalSessions).toBe(0)
    expect(m.dailyActivity).toEqual([])
  })

  test('sums totals, daily activity, model usage, and hour counts', () => {
    const a = sc({
      totalSessions: 10, totalMessages: 100,
      dailyActivity: [{ date: '2026-01-01', messageCount: 5, sessionCount: 2, toolCallCount: 3 }],
      modelUsage: { 'claude-x': { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 1.5 } },
      hourCounts: { '9': 4 },
      firstSessionDate: '2026-01-01', lastComputedDate: '2026-01-10',
    })
    const b = sc({
      totalSessions: 5, totalMessages: 50,
      dailyActivity: [{ date: '2026-01-01', messageCount: 1, sessionCount: 1, toolCallCount: 1 }, { date: '2026-01-02', messageCount: 9, sessionCount: 3, toolCallCount: 0 }],
      modelUsage: { 'claude-x': { inputTokens: 3, outputTokens: 4, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 2.5 } },
      hourCounts: { '9': 1, '10': 2 },
      firstSessionDate: '2025-12-20', lastComputedDate: '2026-01-05',
    })
    const m = mergeStatsCaches([a, b])
    expect(m.totalSessions).toBe(15)
    expect(m.totalMessages).toBe(150)
    // same-date daily activity summed
    expect(m.dailyActivity.find(d => d.date === '2026-01-01')).toEqual({ date: '2026-01-01', messageCount: 6, sessionCount: 3, toolCallCount: 4 })
    expect(m.dailyActivity).toHaveLength(2)
    // model usage summed
    expect(m.modelUsage['claude-x']!.inputTokens).toBe(4)
    expect(m.modelUsage['claude-x']!.costUSD).toBeCloseTo(4)
    // hour counts summed
    expect(m.hourCounts['9']).toBe(5)
    expect(m.hourCounts['10']).toBe(2)
    // earliest first / latest last
    expect(m.firstSessionDate).toBe('2025-12-20')
    expect(m.lastComputedDate).toBe('2026-01-10')
  })
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function usage(overrides: Partial<ModelUsage> = {}): ModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
    costUSD: 0,
    ...overrides,
  }
}

// ── getModelPrice ─────────────────────────────────────────────────────────────

describe('getModelPrice', () => {
  test('retorna preço exato para modelo conhecido', () => {
    expect(getModelPrice('claude-sonnet-4-6')).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0.30,
      cacheWrite: 3.75,
    })
  })

  test('retorna preço exato para opus', () => {
    expect(getModelPrice('claude-opus-4-6')).toEqual({
      input: 5,
      output: 25,
      cacheRead: 0.50,
      cacheWrite: 6.25,
    })
  })

  test('retorna preço exato para haiku', () => {
    const price = getModelPrice('claude-haiku-4-5-20251001')
    expect(price.input).toBe(1)
    expect(price.output).toBe(5)
  })

  test('fallback para sonnet quando modelo desconhecido', () => {
    expect(getModelPrice('modelo-inexistente')).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
    })
  })

  test('match parcial por prefixo — modelId começa com chave conhecida', () => {
    const price = getModelPrice('claude-opus-4-6-custom-suffix')
    expect(price.input).toBe(5)
  })
})

// ── calcCost ──────────────────────────────────────────────────────────────────

describe('calcCost', () => {
  test('zero tokens → custo zero', () => {
    expect(calcCost(usage(), 'claude-sonnet-4-6')).toBe(0)
  })

  test('1M input tokens de sonnet → $3', () => {
    const cost = calcCost(usage({ inputTokens: 1_000_000 }), 'claude-sonnet-4-6')
    expect(cost).toBe(3)
  })

  test('1M output tokens de sonnet → $15', () => {
    const cost = calcCost(usage({ outputTokens: 1_000_000 }), 'claude-sonnet-4-6')
    expect(cost).toBe(15)
  })

  test('1M input + 1M output de sonnet → $18', () => {
    const cost = calcCost(usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), 'claude-sonnet-4-6')
    expect(cost).toBe(18)
  })

  test('cache read tokens aplicam preço correto', () => {
    // 1M cache read de sonnet → $0.30
    const cost = calcCost(usage({ cacheReadInputTokens: 1_000_000 }), 'claude-sonnet-4-6')
    expect(cost).toBeCloseTo(0.30)
  })

  test('cache write tokens aplicam preço correto', () => {
    // 1M cache write de sonnet → $3.75
    const cost = calcCost(usage({ cacheCreationInputTokens: 1_000_000 }), 'claude-sonnet-4-6')
    expect(cost).toBeCloseTo(3.75)
  })

  test('opus custa mais que haiku para mesmo volume de tokens', () => {
    const u = usage({ inputTokens: 100_000, outputTokens: 100_000 })
    expect(calcCost(u, 'claude-opus-4-6')).toBeGreaterThan(calcCost(u, 'claude-haiku-4-5-20251001'))
  })

  test('modelo desconhecido usa preço de fallback (sonnet)', () => {
    const u = usage({ inputTokens: 1_000_000 })
    expect(calcCost(u, 'modelo-desconhecido')).toBe(calcCost(u, 'claude-sonnet-4-6'))
  })

  test('custo proporcional — dobrar tokens dobra custo', () => {
    const base = calcCost(usage({ inputTokens: 500_000 }), 'claude-opus-4-6')
    const double = calcCost(usage({ inputTokens: 1_000_000 }), 'claude-opus-4-6')
    expect(double).toBeCloseTo(base * 2)
  })
})

// ── formatModel ───────────────────────────────────────────────────────────────

describe('formatModel', () => {
  test('retorna nome legível para modelos conhecidos', () => {
    expect(formatModel('claude-sonnet-4-6')).toBe('Sonnet 4.6')
    expect(formatModel('claude-opus-4-6')).toBe('Opus 4.6')
    expect(formatModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  })

  test('retorna o próprio ID para modelos não mapeados', () => {
    expect(formatModel('claude-qualquer-coisa')).toBe('claude-qualquer-coisa')
  })
})

// ── getModelColor ─────────────────────────────────────────────────────────────

describe('getModelColor', () => {
  test('opus tem cor âmbar', () => {
    expect(getModelColor('claude-opus-4-6')).toBe('#D97706')
  })

  test('sonnet tem cor índigo', () => {
    expect(getModelColor('claude-sonnet-4-6')).toBe('#6366f1')
  })

  test('haiku tem cor verde', () => {
    expect(getModelColor('claude-haiku-4-5-20251001')).toBe('#10b981')
  })

  test('modelo desconhecido tem cor padrão', () => {
    expect(getModelColor('outro-modelo')).toBe('#8b5cf6')
  })
})

// ── formatProjectName ─────────────────────────────────────────────────────────

describe('formatProjectName', () => {
  test('retorna "Unknown" para string vazia', () => {
    setHomeDir('')
    expect(formatProjectName('')).toBe('Unknown')
  })

  test('substitui homeDir por ~/', () => {
    setHomeDir('/home/user')
    expect(formatProjectName('/home/user/projetos/app')).toBe('~/projetos/app')
  })

  test('homeDir exato retorna "~ (home)"', () => {
    setHomeDir('/home/user')
    expect(formatProjectName('/home/user')).toBe('~ (home)')
  })

  test('caminho fora do home retorna caminho completo', () => {
    setHomeDir('/home/user')
    expect(formatProjectName('/opt/apps/servidor')).toBe('/opt/apps/servidor')
  })
})

// ── OpenAI/Codex pricing ────────────────────────────────────────────────────────

test('gpt-5.5 resolves to a non-fallback price', () => {
  const price = getModelPrice('gpt-5.5')
  // Must differ from the Sonnet 4.6 fallback ($3 in / $15 out)
  expect(price.input === 3 && price.output === 15).toBe(false)
})

test('calcCost works for a codex usage record', () => {
  const cost = calcCost(
    { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0 },
    'gpt-5.5',
  )
  expect(cost).toBeGreaterThan(0)
})

test('formatModel renders gpt-5.5 readably', () => {
  expect(formatModel('gpt-5.5')).toBe('GPT-5.5')
})

// ── Google/Gemini pricing ────────────────────────────────────────────────────────

test('gemini-3-flash-preview resolves to a non-fallback price', () => {
  const price = getModelPrice('gemini-3-flash-preview')
  // Must NOT fall back to the Sonnet 4.6 rates ($3 in / $15 out)
  expect(price.input === 3 && price.output === 15).toBe(false)
  expect(price.input).toBe(0.5)
  expect(price.output).toBe(3)
  expect(price.cacheRead).toBe(0.05)
})

test('formatModel renders gemini-3-flash-preview as "Gemini 3 Flash"', () => {
  expect(formatModel('gemini-3-flash-preview')).toBe('Gemini 3 Flash')
})

test('getModelColor returns Google blue for gemini models', () => {
  expect(getModelColor('gemini-3-flash-preview')).toBe('#4285f4')
  expect(getModelColor('gemini-2.5-flash')).toBe('#4285f4')
})

test('gemini-2.5-flash resolves to correct price', () => {
  const price = getModelPrice('gemini-2.5-flash')
  expect(price.input).toBe(0.3)
  expect(price.output).toBe(2.5)
})

// ── HARNESS_CAPABILITIES ──────────────────────────────────────────────────────

test('HARNESS_CAPABILITIES declares all four harnesses', () => {
  expect(Object.keys(HARNESS_CAPABILITIES).sort()).toEqual(['claude', 'codex', 'copilot', 'gemini'])
})

test('claude is fully capable; gemini and copilot have tokens/cost/model', () => {
  expect(HARNESS_CAPABILITIES.claude.tokens).toBe(true)
  expect(HARNESS_CAPABILITIES.claude.agents).toBe(true)
  expect(HARNESS_CAPABILITIES.codex.tokens).toBe(true)
  expect(HARNESS_CAPABILITIES.codex.agents).toBe(false)
  // gemini: tokens/cost/model/tools enabled; agents and gitLines not yet supported
  expect(HARNESS_CAPABILITIES.gemini.tokens).toBe(true)
  expect(HARNESS_CAPABILITIES.gemini.cost).toBe(true)
  expect(HARNESS_CAPABILITIES.gemini.model).toBe(true)
  expect(HARNESS_CAPABILITIES.gemini.tools).toBe(true)
  expect(HARNESS_CAPABILITIES.gemini.agents).toBe(false)
  expect(HARNESS_CAPABILITIES.gemini.gitLines).toBe(false)
  // copilot: tokens/cost/model/gitLines enabled; tools and agents not supported
  expect(HARNESS_CAPABILITIES.copilot.tokens).toBe(true)
  expect(HARNESS_CAPABILITIES.copilot.cost).toBe(true)
  expect(HARNESS_CAPABILITIES.copilot.model).toBe(true)
  expect(HARNESS_CAPABILITIES.copilot.tools).toBe(false)
  expect(HARNESS_CAPABILITIES.copilot.agents).toBe(false)
  expect(HARNESS_CAPABILITIES.copilot.gitLines).toBe(true)
})

test('dynamicWorkflows capability is Claude-only', () => {
  expect(HARNESS_CAPABILITIES.claude.dynamicWorkflows).toBe(true)
  expect(HARNESS_CAPABILITIES.codex.dynamicWorkflows).toBe(false)
  expect(HARNESS_CAPABILITIES.gemini.dynamicWorkflows).toBe(false)
  expect(HARNESS_CAPABILITIES.copilot.dynamicWorkflows).toBe(false)
})

describe('normalizeGitRemote', () => {
  test('collapses https, ssh, scp, and git protocols to host/org/repo', () => {
    const cases: [string, string][] = [
      ['https://github.com/org/repo.git', 'github.com/org/repo'],
      ['https://github.com/org/repo', 'github.com/org/repo'],
      ['git@github.com:org/repo.git', 'github.com/org/repo'],
      ['git@github.com:org/repo', 'github.com/org/repo'],
      ['ssh://git@github.com/org/repo', 'github.com/org/repo'],
      ['ssh://git@github.com:22/org/repo.git', 'github.com/org/repo'],
      ['git://github.com/org/repo.git', 'github.com/org/repo'],
      ['github.com/org/repo', 'github.com/org/repo'],
    ]
    for (const [input, expected] of cases) {
      expect(normalizeGitRemote(input)).toBe(expected)
    }
  })

  test('strips embedded credentials incl. CI tokens', () => {
    expect(normalizeGitRemote('https://user:token@github.com/org/repo.git')).toBe('github.com/org/repo')
    expect(normalizeGitRemote('https://x-access-token:ghs_abc123@github.com/org/repo')).toBe('github.com/org/repo')
  })

  test('lowercases host but preserves path case', () => {
    expect(normalizeGitRemote('https://GitHub.com/Org/Repo.git')).toBe('github.com/Org/Repo')
  })

  test('handles trailing slashes and nested paths (self-hosted / subgroups)', () => {
    expect(normalizeGitRemote('https://gitlab.example.com/group/subgroup/repo.git/')).toBe('gitlab.example.com/group/subgroup/repo')
  })

  test('returns "" for non-remotes, local paths, and junk', () => {
    expect(normalizeGitRemote('')).toBe('')
    expect(normalizeGitRemote(undefined)).toBe('')
    expect(normalizeGitRemote(null)).toBe('')
    expect(normalizeGitRemote('file:///home/user/repo.git')).toBe('')
    expect(normalizeGitRemote('/home/user/repo')).toBe('')
    expect(normalizeGitRemote('justastring')).toBe('')
  })

  test('is idempotent — normalizing an already-normalized value is a no-op', () => {
    const once = normalizeGitRemote('git@github.com:org/repo.git')
    expect(normalizeGitRemote(once)).toBe(once)
  })
})

describe('repoShortName', () => {
  test('drops the host, keeping org/repo', () => {
    expect(repoShortName('github.com/org/repo')).toBe('org/repo')
    expect(repoShortName('gitlab.example.com/group/subgroup/repo')).toBe('group/subgroup/repo')
    expect(repoShortName('')).toBe('')
  })
})
