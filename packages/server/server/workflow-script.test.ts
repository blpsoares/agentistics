import { test, expect } from 'bun:test'
import { parseWorkflowScript } from './workflow-script'

const SCRIPT = `
export const meta = {
  name: 'review-changes',
  description: 'x',
  phases: [ { title: 'Review' }, { title: 'Verify' } ],
}
await agent('do review', { label: 'review:bugs', phase: 'Review', model: 'claude-sonnet-5' })
await agent('verify it', { label: 'verify:bugs', phase: 'Verify' })
`

test('extracts name and phase titles', () => {
  const r = parseWorkflowScript(SCRIPT)
  expect(r.name).toBe('review-changes')
  expect(r.phases).toEqual(['Review', 'Verify'])
})

test('extracts agent label/phase/model with defaults', () => {
  const r = parseWorkflowScript(SCRIPT)
  expect(r.agents).toEqual([
    { label: 'review:bugs', phase: 'Review', model: 'claude-sonnet-5' },
    { label: 'verify:bugs', phase: 'Verify', model: '' },
  ])
})

test('empty script yields empty shape', () => {
  expect(parseWorkflowScript('')).toEqual({ name: '', phases: [], agents: [] })
})
