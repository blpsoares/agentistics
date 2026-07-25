import { test, expect } from 'bun:test'
import { valueFontSize } from './StatCard'

test('the same amount gets the same size in EN and PT despite a longer currency prefix', () => {
  // The bug: measuring the whole string counted "USD " (4 chars) against "R$" (2), pushing the
  // English card across a threshold and rendering it two steps smaller for the same magnitude.
  expect(valueFontSize('USD 16,611.61')).toBe(valueFontSize('R$16.611,61'))
  expect(valueFontSize('R$84.362,05')).toBe(valueFontSize('USD 84,362.05'))
})

test('size still shrinks as the number itself grows', () => {
  expect(valueFontSize('R$5')).toBe(26)          // '5'            → 1 char
  expect(valueFontSize('R$12.345')).toBe(22)     // '12.345'       → 6 chars
  expect(valueFontSize('R$84.362,05')).toBe(19)  // '84.362,05'    → 9 chars
  expect(valueFontSize('R$1.234.567,89')).toBe(15) // '1.234.567,89' → 12 chars
})

test('plain numbers and non-currency values still scale', () => {
  expect(valueFontSize(811)).toBe(26)
  expect(valueFontSize('212.494')).toBe(22)
  expect(valueFontSize(1234567890123)).toBe(15)
})

test('a negative value keeps its sign in the measurement', () => {
  // The strip regex deliberately spares a leading '-' so a negative delta is not measured as if
  // it were one character shorter than it renders.
  expect(valueFontSize('-123456')).toBe(22) // 7 chars including the sign
})
