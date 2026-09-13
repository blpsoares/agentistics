import { describe, test, expect } from 'bun:test'
import { filtrosPanelInert, sessionsFiltersShouldReturnFocus } from './sessionsFiltersPanel'

describe('filtrosPanelInert', () => {
  test('collapsed panel is inert', () => {
    expect(filtrosPanelInert(false)).toBe(true)
  })

  test('open panel is NOT inert — the attribute is absent, not false', () => {
    expect(filtrosPanelInert(true)).toBeUndefined()
  })
})

describe('sessionsFiltersShouldReturnFocus', () => {
  test('collapsing while focus is inside the panel returns it to the trigger', () => {
    expect(sessionsFiltersShouldReturnFocus(false, true)).toBe(true)
  })

  test('collapsing while focus is elsewhere leaves it alone', () => {
    expect(sessionsFiltersShouldReturnFocus(false, false)).toBe(false)
  })

  test('opening never moves focus, whatever it is doing right now', () => {
    expect(sessionsFiltersShouldReturnFocus(true, true)).toBe(false)
    expect(sessionsFiltersShouldReturnFocus(true, false)).toBe(false)
  })
})
