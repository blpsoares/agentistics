import { test, expect } from 'bun:test'
import { archiveGateOnOpen } from './archive-gate'

test('asks when the machine has never answered, preselecting what the host recommends', () => {
  expect(archiveGateOnOpen('consolidate', false)).toEqual({ ask: true, suggested: 'consolidate' })
})

test('never asks once the choice is on record — a machine coming back up is not asked again', () => {
  expect(archiveGateOnOpen(null, false)).toEqual({ ask: false })
  expect(archiveGateOnOpen(null, true)).toEqual({ ask: false })
})

test('a skip is honoured for the rest of this run — the gate does not re-open behind the user', () => {
  expect(archiveGateOnOpen('consolidate', true)).toEqual({ ask: false })
})

test('carries the recommendation through, whatever it is', () => {
  expect(archiveGateOnOpen('full', false)).toEqual({ ask: true, suggested: 'full' })
})
