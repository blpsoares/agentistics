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

test('tolerates prompts containing braces and template literals', () => {
  const script = "await agent(`fix function f() {} in ${file}`, { label: 'braces', phase: 'Review', model: 'claude-sonnet-5' })"
  const r = parseWorkflowScript(script)
  expect(r.agents).toEqual([{ label: 'braces', phase: 'Review', model: 'claude-sonnet-5' }])
})

test('option-less agent call does not steal the next call options', () => {
  const script = [
    "await agent('just a prompt')",
    "await agent('second', { label: 'b', phase: 'Verify', model: 'claude-haiku-4-5' })",
  ].join('\n')
  const r = parseWorkflowScript(script)
  expect(r.agents).toEqual([
    { label: '', phase: '', model: '' },
    { label: 'b', phase: 'Verify', model: 'claude-haiku-4-5' },
  ])
})
