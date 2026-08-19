import { test, expect } from 'bun:test'
import { DEFAULT_CARD_ORDER, migrateCardOrder, type CardId } from './cardOrder'

test('a fresh install gets the default order', () => {
  expect(migrateCardOrder([])).toEqual(DEFAULT_CARD_ORDER)
})

test('an untouched saved order is returned unchanged', () => {
  expect(migrateCardOrder(DEFAULT_CARD_ORDER)).toEqual(DEFAULT_CARD_ORDER)
})

// --- the migration this module exists for ----------------------------------------------------

test('the two legacy token cards collapse into one, at the FIRST of the pair', () => {
  const saved = ['messages', 'input-tokens', 'output-tokens', 'sessions']
  const out = migrateCardOrder(saved)
  expect(out.filter(id => id === 'tokens')).toEqual(['tokens'])
  expect(out.indexOf('tokens')).toBe(1) // where the user had put their tokens
})

test('a customized row keeps its arrangement across the rename', () => {
  // Someone who moved cost to the front and tokens to the end.
  const saved = ['cost', 'messages', 'sessions', 'tool-calls', 'streak',
    'longest-session', 'commits', 'files', 'input-tokens', 'output-tokens']
  const out = migrateCardOrder(saved)
  expect(out[0]).toBe('cost')
  expect(out[out.length - 1]).toBe('tokens')
  expect(out).toHaveLength(DEFAULT_CARD_ORDER.length)
})

test('a saved order holding only ONE of the legacy pair still yields the tokens card', () => {
  // Reachable: the settings screen let a card be removed, and only output-tokens was kept.
  const out = migrateCardOrder(['messages', 'output-tokens'])
  expect(out).toContain('tokens')
  expect(out.filter(id => id === 'tokens')).toHaveLength(1)
})

test('a saved order with NO token card gets one back, in its default neighbourhood', () => {
  // The regression the module guards: dropping unknown ids silently is how a card disappears.
  const out = migrateCardOrder(['messages', 'sessions', 'tool-calls', 'cost'])
  expect(out).toContain('tokens')
  expect(out.indexOf('tokens')).toBe(3) // right after tool-calls, as in the default
})

// --- general reconciliation ------------------------------------------------------------------

test('unknown ids are dropped rather than rendered', () => {
  const out = migrateCardOrder(['messages', 'not-a-card', 'sessions'])
  expect(out).not.toContain('not-a-card' as CardId)
})

test('duplicates in a corrupted saved order are collapsed', () => {
  const out = migrateCardOrder(['messages', 'messages', 'sessions'])
  expect(out.filter(id => id === 'messages')).toHaveLength(1)
})

test('every card appears exactly once, whatever the input', () => {
  const inputs: string[][] = [
    [],
    ['input-tokens', 'output-tokens'],
    ['files', 'commits'],
    ['garbage', 'input-tokens', 'garbage', 'output-tokens'],
    [...DEFAULT_CARD_ORDER].reverse(),
  ]
  for (const saved of inputs) {
    const out = migrateCardOrder(saved)
    expect(out.length).toBe(DEFAULT_CARD_ORDER.length)
    expect(new Set(out).size).toBe(DEFAULT_CARD_ORDER.length)
    for (const id of DEFAULT_CARD_ORDER) expect(out).toContain(id)
  }
})

test('the row keeps a cell count whose grid comes out flush at five columns', () => {
  // The layout constraint, asserted rather than eyeballed: the tokens card spans TWO cells
  // (.ag-span-2), so the row occupies DEFAULT_CARD_ORDER.length + 1 cells. Ten cells fill two
  // rows of five exactly — which is what the row looked like before the swap.
  const cells = DEFAULT_CARD_ORDER.length + 1
  expect(cells % 5).toBe(0)
})
