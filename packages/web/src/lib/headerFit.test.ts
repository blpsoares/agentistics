import { test, expect } from 'bun:test'
import { headerFit, FULL_BAR_W, DATE_FULL_W, DATE_COMPACT_W } from './headerFit'

test('a wide strip keeps the presets and the from/to range on the line', () => {
  expect(headerFit(1200).date).toBe('full')
  expect(headerFit(FULL_BAR_W).date).toBe('full')
})

test('one pixel under the requirement collapses the date block rather than clipping it', () => {
  expect(headerFit(FULL_BAR_W - 1).date).toBe('compact')
  expect(headerFit(200).date).toBe('compact')
})

test('an unmeasured width answers full — never a collapse on first paint', () => {
  expect(headerFit(0).date).toBe('full')
  expect(headerFit(-1).date).toBe('full')
  expect(headerFit(Number.NaN).date).toBe('full')
})

test('the compact block is genuinely smaller — otherwise collapsing buys nothing', () => {
  expect(DATE_COMPACT_W).toBeLessThan(DATE_FULL_W)
})
