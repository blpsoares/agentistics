import { describe, it, expect } from 'bun:test'
import {
  FLEET_GROUPINGS, isFleetGrouping, groupingLabel, fleetWordBook, parseGrouping,
} from './fleetGrouping'
import { DIMENSION_ORDER } from '@agentistics/tui/control/session-fleet'

describe('FLEET_GROUPINGS', () => {
  it('offers every cockpit dimension, plus this page\'s own Running split', () => {
    // A dimension the cockpit bands by and the web does not is a fleet that reads differently in
    // two places for no reason anyone chose.
    for (const id of DIMENSION_ORDER) expect(FLEET_GROUPINGS).toContain(id)
    expect(FLEET_GROUPINGS[0]).toBe('active')
    expect(FLEET_GROUPINGS.length).toBe(DIMENSION_ORDER.length + 1)
  })

  it('keeps `active` distinct from the `status` dimension', () => {
    // `status` bands by exact state (working / waiting / waiting-approval / …), which is a finer
    // question than "what is running". Collapsing them would silently replace the default this
    // page shipped with by its nearest relative.
    expect(FLEET_GROUPINGS).toContain('active')
    expect(FLEET_GROUPINGS).toContain('status')
    expect(groupingLabel('active', 'en')).not.toBe(groupingLabel('status', 'en'))
  })
})

describe('isFleetGrouping', () => {
  it('accepts every offered id and rejects everything else', () => {
    for (const id of FLEET_GROUPINGS) expect(isFleetGrouping(id)).toBe(true)
    for (const junk of ['tree', 'none', '', 'Project', 42, null, undefined, {}]) {
      expect(isFleetGrouping(junk)).toBe(false)
    }
  })
})

describe('groupingLabel', () => {
  it('names every grouping in both languages, and never the same word twice', () => {
    for (const lang of ['en', 'pt'] as const) {
      const seen = new Set<string>()
      for (const id of FLEET_GROUPINGS) {
        const label = groupingLabel(id, lang)
        expect(label.length).toBeGreaterThan(0)
        expect(seen.has(label)).toBe(false)  // two bands offering the same word is unusable
        seen.add(label)
      }
    }
  })
})

describe('fleetWordBook', () => {
  it('names every dimension and every "no value" bucket', () => {
    for (const lang of ['en', 'pt'] as const) {
      const book = fleetWordBook(lang)
      for (const id of DIMENSION_ORDER) {
        expect(book[id].label.length).toBeGreaterThan(0)
        expect(book[id].unfiled.length).toBeGreaterThan(0)
      }
    }
  })

  it('gives each dimension its OWN absence sentence', () => {
    // "no model recorded" and "assistant unknown" are different facts; one blank heading shared
    // between them reads as a category that does not exist.
    const book = fleetWordBook('en')
    const unfiled = DIMENSION_ORDER.map(id => book[id].unfiled)
    expect(new Set(unfiled).size).toBe(unfiled.length)
  })

  it('translates the state words rather than repeating English', () => {
    const en = fleetWordBook('en')
    const pt = fleetWordBook('pt')
    expect(en.status.values?.working).toBe('working')
    expect(pt.status.values?.working).toBe('trabalhando')
    expect(pt.status.values?.['waiting-approval']).not.toBe(en.status.values?.['waiting-approval'])
  })

  it('supplies no day names — an unnamed day falls back to its own readable date', () => {
    // Naming "today" needs a clock this module does not read. A degraded heading beats a wrong one.
    expect(fleetWordBook('en').day.values).toBeUndefined()
  })
})

describe('parseGrouping', () => {
  it('defaults to the Running split when nothing is stored', () => {
    expect(parseGrouping(null)).toBe('active')
    expect(parseGrouping(undefined)).toBe('active')
    expect(parseGrouping('')).toBe('active')
  })

  it('accepts every offered id', () => {
    for (const id of FLEET_GROUPINGS) expect(parseGrouping(id)).toBe(id)
  })

  it('falls back for an id this build does not offer', () => {
    // A build that offered `tree` (the cascade, which the cockpit migrated away from) would
    // otherwise hand an unknown dimension straight to groupSessions.
    expect(parseGrouping('tree')).toBe('active')
    expect(parseGrouping('none')).toBe('active')
    expect(parseGrouping('{"not":"an id"}')).toBe('active')
    expect(parseGrouping('Project')).toBe('active')
  })
})
