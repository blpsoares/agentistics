import { describe, test, expect } from 'bun:test'
import { calcStreak, getDateRangeFilter } from './useData'

// ── calcStreak ────────────────────────────────────────────────────────────────

describe('calcStreak', () => {
  // Data de referência fixa para evitar flakiness
  const TODAY = new Date('2026-04-10T12:00:00.000Z')

  // Datas no formato UTC (slice do toISOString)
  const d = (offset: number) =>
    new Date(TODAY.getTime() - offset * 86_400_000).toISOString().slice(0, 10)

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
