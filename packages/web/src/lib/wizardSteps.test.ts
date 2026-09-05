import { describe, expect, it } from 'bun:test'
import {
  STEP_ORDER, clearForHarness, nextStep, prevStep, stepReady, visibleQuestions,
  type WizardDraft,
} from './wizardSteps'

const claude = {
  id: 'claude', label: 'Claude Code',
  models: [{ id: 'opus', label: 'Opus 5' }],
  supportsModel: true, efforts: ['low', 'high'],
}
const codex = { id: 'codex', label: 'Codex', models: [], supportsModel: true, efforts: [] }
const empty: WizardDraft = {
  harness: '', cwd: '', task: '', model: '', effort: '', prompt: '', label: '', attachments: [],
}

describe('STEP_ORDER', () => {
  it('is assistant, where, message, review', () => {
    expect(STEP_ORDER).toEqual(['assistant', 'where', 'message', 'review'])
  })
})

describe('stepReady', () => {
  it('blocks step 1 until an assistant is chosen, and says what is missing', () => {
    const out = stepReady('assistant', empty, null)
    expect(out.ok).toBe(false)
    expect(out.missing).not.toBe('')
  })
  it('accepts step 1 with only an assistant — model, effort and name are optional', () => {
    expect(stepReady('assistant', { ...empty, harness: 'claude' }, claude).ok).toBe(true)
  })
  it('blocks step 2 until a directory is chosen', () => {
    expect(stepReady('where', { ...empty, harness: 'claude' }, claude).ok).toBe(false)
    expect(stepReady('where', { ...empty, harness: 'claude', cwd: '/home/u/p' }, claude).ok).toBe(true)
  })
  it('never blocks step 3 — the first message is optional', () => {
    expect(stepReady('message', { ...empty, harness: 'claude', cwd: '/home/u/p' }, claude).ok).toBe(true)
  })
  it('accepts review only when every earlier step does', () => {
    expect(stepReady('review', { ...empty, harness: 'claude' }, claude).ok).toBe(false)
    expect(stepReady('review', { ...empty, harness: 'claude', cwd: '/home/u/p' }, claude).ok).toBe(true)
  })
})

describe('visibleQuestions', () => {
  it('asks for a model only when the harness names some', () => {
    expect(visibleQuestions(claude).model).toBe(true)
    // supportsModel is true for codex, but it names no models — a dropdown whose only entry is
    // "the assistant's default" is a control that cannot be used.
    expect(visibleQuestions(codex).model).toBe(false)
  })
  it('asks for an effort only when the CLI prints a closed set', () => {
    expect(visibleQuestions(claude).effort).toBe(true)
    expect(visibleQuestions(codex).effort).toBe(false)
  })
  it('asks nothing extra when there is no harness yet', () => {
    expect(visibleQuestions(null)).toEqual({ model: false, effort: false })
  })
})

describe('navigation', () => {
  it('walks forward and back without falling off either end', () => {
    expect(nextStep('assistant')).toBe('where')
    expect(nextStep('review')).toBe('review')
    expect(prevStep('assistant')).toBe('assistant')
    expect(prevStep('review')).toBe('message')
  })
})

describe('clearForHarness', () => {
  it('drops a model and an effort the new assistant does not accept', () => {
    const d = { ...empty, harness: 'codex', model: 'opus', effort: 'high' }
    expect(clearForHarness(d, codex)).toMatchObject({ model: '', effort: '' })
  })
  it('keeps a model the new assistant does name', () => {
    const d = { ...empty, harness: 'claude', model: 'opus', effort: 'high' }
    expect(clearForHarness(d, claude)).toMatchObject({ model: 'opus', effort: 'high' })
  })
  it('never touches the answers that belong to any assistant', () => {
    const d = { ...empty, harness: 'codex', cwd: '/p', task: 't', prompt: 'go', label: 'n' }
    expect(clearForHarness(d, codex)).toMatchObject({ cwd: '/p', task: 't', prompt: 'go', label: 'n' })
  })
})
