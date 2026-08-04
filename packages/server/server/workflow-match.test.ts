import { test, expect } from 'bun:test'
import { matchTranscriptsToCalls } from './workflow-match'

const CALLS = [
  { label: 'recon:services', phase: 'Recon', model: '', fingerprints: ['mapeie a camada de servicos em background'] },
  { label: 'recon:mouse', phase: 'Recon', model: '', fingerprints: ['mapeie a camada de mouse'] },
  { label: 'fix:backends', phase: 'Backends', model: '', fingerprints: ['CONSERTAR os backends de background'] },
]

test('matches each transcript to the call whose prompt it carries, regardless of file order', () => {
  // Deliberately in an order that has nothing to do with the call order — this is the real
  // world: transcripts are named agent-<hash>.jsonl and sort alphabetically by hash.
  const got = matchTranscriptsToCalls(
    [
      { prompt: 'preambulo... TAREFA: CONSERTAR os backends de background. Voce e dono.' },
      { prompt: 'preambulo... TAREFA: mapeie a camada de mouse. Leia parse.ts.' },
      { prompt: 'preambulo... TAREFA: mapeie a camada de servicos em background. Leia detect.ts.' },
    ],
    CALLS,
  )
  expect(got.map(c => c?.label)).toEqual(['fix:backends', 'recon:mouse', 'recon:services'])
})

test('one call may claim many transcripts — a loop reuses the same call site', () => {
  const got = matchTranscriptsToCalls(
    [
      { prompt: 'x mapeie a camada de mouse y' },
      { prompt: 'z mapeie a camada de mouse w' },
    ],
    CALLS,
  )
  expect(got.map(c => c?.label)).toEqual(['recon:mouse', 'recon:mouse'])
})

test('a transcript matching no call yields undefined rather than a wrong label', () => {
  const got = matchTranscriptsToCalls([{ prompt: 'something else entirely' }], CALLS)
  expect(got).toEqual([undefined])
})

test('the most specific (longest) matching fingerprint wins', () => {
  const calls = [
    { label: 'broad', phase: '', model: '', fingerprints: ['leia o repositorio'] },
    { label: 'narrow', phase: '', model: '', fingerprints: ['leia o repositorio e conserte o parser SGR'] },
  ]
  const got = matchTranscriptsToCalls([{ prompt: 'a: leia o repositorio e conserte o parser SGR.' }], calls)
  expect(got.map(c => c?.label)).toEqual(['narrow'])
})

test('an ambiguous tie is reported as unknown, never guessed', () => {
  const calls = [
    { label: 'a', phase: '', model: '', fingerprints: ['identical prompt text'] },
    { label: 'b', phase: '', model: '', fingerprints: ['identical prompt text'] },
  ]
  expect(matchTranscriptsToCalls([{ prompt: 'identical prompt text' }], calls)).toEqual([undefined])
})

test('calls with no usable fingerprint never match anything', () => {
  const calls = [{ label: 'dynamic', phase: '', model: '', fingerprints: [] }]
  expect(matchTranscriptsToCalls([{ prompt: 'anything' }], calls)).toEqual([undefined])
})

test('empty inputs are safe', () => {
  expect(matchTranscriptsToCalls([], CALLS)).toEqual([])
  expect(matchTranscriptsToCalls([{ prompt: 'x' }], [])).toEqual([undefined])
})
