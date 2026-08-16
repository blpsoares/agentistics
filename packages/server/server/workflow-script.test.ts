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
    { label: 'review:bugs', phase: 'Review', model: 'claude-sonnet-5', fingerprints: [] },
    { label: 'verify:bugs', phase: 'Verify', model: '', fingerprints: [] },
  ])
})

test('empty script yields empty shape', () => {
  expect(parseWorkflowScript('')).toEqual({ name: '', phases: [], agents: [] })
})

test('tolerates prompts containing braces and template literals', () => {
  const script = "await agent(`fix function f() {} in ${file}`, { label: 'braces', phase: 'Review', model: 'claude-sonnet-5' })"
  const r = parseWorkflowScript(script)
  expect(r.agents).toEqual([{ label: 'braces', phase: 'Review', model: 'claude-sonnet-5', fingerprints: [] }])
})

test('option-less agent call does not steal the next call options', () => {
  const script = [
    "await agent('just a prompt')",
    "await agent('second', { label: 'b', phase: 'Verify', model: 'claude-haiku-4-5' })",
  ].join('\n')
  const r = parseWorkflowScript(script)
  expect(r.agents).toEqual([
    { label: '', phase: '', model: '', fingerprints: [] },
    { label: 'b', phase: 'Verify', model: 'claude-haiku-4-5', fingerprints: [] },
  ])
})

test('captures literal prompt segments as fingerprints, longest first', () => {
  const script = [
    'const COMMON = `preamble`',
    'await agent(`${COMMON}',
    'TAREFA: mapear a camada de servico em background e responder citando arquivo:linha.',
    'Curto.`, { label: "recon:services", phase: "Recon" })',
  ].join('\n')
  const r = parseWorkflowScript(script)
  expect(r.agents).toHaveLength(1)
  expect(r.agents[0]!.label).toBe('recon:services')
  expect(r.agents[0]!.fingerprints[0]).toContain('TAREFA: mapear a camada de servico em background')
})

test('drops fingerprints too short to identify an agent', () => {
  const script = 'await agent(`${A} ok ${B}`, { label: "tiny" })'
  expect(parseWorkflowScript(script).agents[0]!.fingerprints).toEqual([])
})

test('a plain string prompt is its own fingerprint', () => {
  const script = "await agent('conserte o parser SGR do mouse na TUI do projeto', { label: 'fix:mouse' })"
  expect(parseWorkflowScript(script).agents[0]!.fingerprints)
    .toEqual(['conserte o parser SGR do mouse na TUI do projeto'])
})

test('a nested template inside an interpolation does not leak into the fingerprint', () => {
  const script = [
    'await agent(`ANTES',
    '${items.map(i => `- ${i.file}: ${i.fact}`).join("\\n")}',
    'DEPOIS: corrija tudo o que foi confirmado acima, sem excecao.`, { label: "fix" })',
  ].join('\n')
  const fps = parseWorkflowScript(script).agents[0]!.fingerprints
  expect(fps.some(f => f.includes('i.file'))).toBe(false)
  expect(fps[0]).toContain('DEPOIS: corrija tudo o que foi confirmado acima')
})
