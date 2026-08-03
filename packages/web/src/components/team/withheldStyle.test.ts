import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { FAULT_COLOR, WITHHELD_BG, WITHHELD_FG, withheldMarkStyle } from './withheldStyle'

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf-8')

/** Every surface that marks something as withheld from a central. */
const MARK_SITES = [
  '../RepositoriesList.tsx',
  '../../pages/RepoDetailPage.tsx',
  './ConnectionCard.tsx',
] as const

test('the withheld marker is red, but never the fault colour', () => {
  const { background, color } = withheldMarkStyle()
  expect(background).toBe(WITHHELD_BG)
  expect(color).toBe(WITHHELD_FG)
  // Recognisably the red family — this is what the marker MEANS.
  expect(color).toContain('--accent-red')
  expect(background).toContain('--accent-red')
  // …and never the bare fault value, which offline / unauthorized / broken-connection all use.
  // A withheld repository is a choice the user made, not a fault, and the two appear on one card.
  expect(color).not.toBe(FAULT_COLOR)
  expect(background).not.toBe(FAULT_COLOR)
  // Desaturated, not merely tinted: the foreground must be mixed toward ordinary text.
  expect(color).toContain('--text-secondary')
  // The fill stays under the fault fills, which sit at 10-12%.
  const pct = Number(/(\d+)%/.exec(background)?.[1])
  expect(pct).toBeGreaterThan(0)
  expect(pct).toBeLessThan(10)
})

test('every withheld marker uses the shared token and none keeps its own orange', () => {
  let checked = 0
  for (const site of MARK_SITES) {
    const src = read(site)
    // It must go through the token, or the three drift apart again — which is how they ended up
    // as three copies of an orange that meant something else.
    expect(src).toContain('withheldMarkStyle')
    // The crossed-eye is the marker's other half: the owner asked for it by name, and an icon
    // survives the colour being invisible to the reader.
    expect(src).toContain('EyeOff')
    // No site may still paint a withheld marker in the advisory orange.
    expect(src).not.toContain('color-mix(in srgb, var(--anthropic-orange) 12%, transparent)')
    expect(src).not.toContain('color-mix(in srgb, var(--anthropic-orange) 15%, transparent)')
    checked++
  }
  // Guards the loop: an empty or shortened list would otherwise pass asserting nothing.
  expect(checked).toBe(MARK_SITES.length)
  expect(checked).toBe(3)
})

test('the machine card\'s own hidden block stays free of the marker, and of alarm', () => {
  // The connection card's hidden BLOCK is a table of what this machine withholds — every row is
  // there because the user put it there, and it is already under a heading that says so. A badge
  // repeated on each row would be the alarm this token exists to avoid. The collapsed card's rule
  // PILL is the marker (it is a summary seen without the block), which is why ConnectionCard.tsx
  // is a mark site and SharedReposPanel.tsx is not.
  const src = read('./SharedReposPanel.tsx')
  expect(src).not.toContain('withheldMarkStyle')
  expect(src).not.toContain('EyeOff')
})
