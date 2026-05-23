import { describe, test, expect } from 'bun:test'
import { calcCost, getModelPrice, formatModel, getModelColor, formatProjectName, setHomeDir } from './types'
import type { ModelUsage } from './types'

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
