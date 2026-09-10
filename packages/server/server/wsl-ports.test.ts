import { expect, test } from 'bun:test'
import { findFreePortPair, parseExcludedRanges, portInAnyRange } from './wsl-ports'

test('parses a real netsh excludedportrange table, Portuguese locale, asterisk and all', () => {
  const output = `
Protocolo tcp Intervalos de Exclusão de Porta

Porta Inicial    Porta Final
----------    --------
      5357        5357
      8883        8883
     47277       47376
     50000       50059     *
     55245       55344

* - Exclusões de porta administradas.
`
  expect(parseExcludedRanges(output)).toEqual([
    { start: 5357, end: 5357 },
    { start: 8883, end: 8883 },
    { start: 47277, end: 47376 },
    { start: 50000, end: 50059 },
    { start: 55245, end: 55344 },
  ])
})

test('parses the English-locale header the same way — the parser reads numbers, not labels', () => {
  const output = `
Protocol tcp Port Exclusion Ranges

Start Port    End Port
----------    --------
     47291       47291
`
  expect(parseExcludedRanges(output)).toEqual([{ start: 47291, end: 47291 }])
})

test('an empty or garbage table yields no ranges rather than throwing', () => {
  expect(parseExcludedRanges('')).toEqual([])
  expect(parseExcludedRanges('access denied\nsomething went wrong')).toEqual([])
})

test('portInAnyRange is true only when the port falls inside a listed range, inclusive', () => {
  const ranges = [{ start: 47277, end: 47376 }]
  expect(portInAnyRange(ranges, 47276)).toBe(false)
  expect(portInAnyRange(ranges, 47277)).toBe(true)
  expect(portInAnyRange(ranges, 47320)).toBe(true)
  expect(portInAnyRange(ranges, 47376)).toBe(true)
  expect(portInAnyRange(ranges, 47377)).toBe(false)
})

test('findFreePortPair returns the default pair untouched when nothing conflicts', () => {
  expect(findFreePortPair([], 47291)).toEqual({ port: 47291, webPort: 47292 })
})

test('findFreePortPair steps past an excluded range that covers the default pair', () => {
  // This is the real machine's measured case: 47291/47292 both fall inside 47277-47376.
  const ranges = [{ start: 47277, end: 47376 }]
  const found = findFreePortPair(ranges, 47291)
  expect(found).not.toBeNull()
  expect(found!.port).toBeGreaterThan(47376)
  expect(portInAnyRange(ranges, found!.port)).toBe(false)
  expect(portInAnyRange(ranges, found!.webPort)).toBe(false)
})

test('findFreePortPair skips a pair only half-covered by a range', () => {
  // 47292 (the would-be webPort) is excluded even though 47291 is not — a pair is only free when
  // BOTH ports clear every range, or the dashboard would bind to a port Windows still won't relay.
  const ranges = [{ start: 47292, end: 47292 }]
  const found = findFreePortPair(ranges, 47291)
  expect(found).toEqual({ port: 47293, webPort: 47294 })
})

test('findFreePortPair gives up honestly rather than searching forever', () => {
  // A single range spanning the whole search budget leaves nothing to find.
  const ranges = [{ start: 1, end: 100000 }]
  expect(findFreePortPair(ranges, 47291, 50)).toBeNull()
})
