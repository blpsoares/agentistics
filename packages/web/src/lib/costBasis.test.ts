import { describe, test, expect } from 'bun:test'
import { costBasisMarker, formatMultiple, viewCost } from './costBasis'

describe('viewCost', () => {
  test('api basis is an identity', () => {
    const v = viewCost(123.45, { basis: 'api', factor: 0.2 })
    expect(v).toEqual({ usd: 123.45, basis: 'api', allocated: false, unavailable: false })
  })

  test('plan basis scales by the factor', () => {
    const v = viewCost(1000, { basis: 'plan', factor: 0.1 })
    expect(v.usd).toBeCloseTo(100, 9)
    expect(v.basis).toBe('plan')
    expect(v.unavailable).toBe(false)
  })

  test('a null factor NEVER produces a plan number', () => {
    // The surface asked for the plan basis and cannot have it. It gets the API figure plus the
    // flag; a silent 0 here would be a confident lie on the most-read number in the app.
    const v = viewCost(1000, { basis: 'plan', factor: null })
    expect(v.usd).toBe(1000)
    expect(v.basis).toBe('api')
    expect(v.unavailable).toBe(true)
  })

  test('a non-finite factor is treated as no factor', () => {
    for (const factor of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const v = viewCost(1000, { basis: 'plan', factor })
      expect(v.unavailable).toBe(true)
      expect(Number.isFinite(v.usd)).toBe(true)
    }
  })

  test('allocated travels with the value and is never inferred', () => {
    expect(viewCost(10, { basis: 'plan', factor: 2, allocated: true }).allocated).toBe(true)
    expect(viewCost(10, { basis: 'plan', factor: 2 }).allocated).toBe(false)
    // An unavailable plan figure is not an allocation of anything.
    expect(viewCost(10, { basis: 'plan', factor: null, allocated: true }).allocated).toBe(false)
  })

  test('a zero cost stays zero in either basis', () => {
    expect(viewCost(0, { basis: 'plan', factor: 0.5 }).usd).toBe(0)
  })
})

describe('costBasisMarker', () => {
  test('says nothing when nothing needs saying', () => {
    // Marking an API figure on an API-basis page trains people to ignore the marker that matters.
    expect(costBasisMarker(viewCost(10, { basis: 'api', factor: null }), 'en')).toBeNull()
    expect(costBasisMarker(viewCost(10, { basis: 'plan', factor: 2 }), 'en')).toBeNull()
  })

  test('names an allocation', () => {
    const v = viewCost(10, { basis: 'plan', factor: 2, allocated: true })
    expect(costBasisMarker(v, 'en')).toBe('allocated')
    expect(costBasisMarker(v, 'pt')).toBe('rateado')
  })

  test('names the missing plan', () => {
    const v = viewCost(10, { basis: 'plan', factor: null })
    expect(costBasisMarker(v, 'en')).toBe('no registered plan')
    expect(costBasisMarker(v, 'pt')).toBe('sem plano cadastrado')
  })
})

describe('formatMultiple', () => {
  test('null stays null — an absent multiple is not 1x', () => {
    expect(formatMultiple(null, 'en')).toBeNull()
    expect(formatMultiple(Number.POSITIVE_INFINITY, 'en')).toBeNull()
    expect(formatMultiple(Number.NaN, 'en')).toBeNull()
  })

  test('precision drops as the number grows', () => {
    expect(formatMultiple(8.523, 'en')).toBe('8.52×')
    expect(formatMultiple(12.34, 'en')).toBe('12.3×')
    expect(formatMultiple(140.6, 'en')).toBe('141×')
  })

  test('pt uses a comma', () => {
    expect(formatMultiple(8.5, 'pt')).toBe('8,50×')
    expect(formatMultiple(8.5, 'en')).toBe('8.50×')
  })
})
