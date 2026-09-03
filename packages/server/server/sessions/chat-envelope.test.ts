import { describe, expect, it } from 'bun:test'
import { classifyUserText } from './chat-envelope'

describe('classifyUserText', () => {
  it('keeps a plain message as the person’s, verbatim', () => {
    expect(classifyUserText('  faz isso aí  ')).toEqual({ kind: 'person', text: 'faz isso aí' })
  })

  // The report this module exists for: the user circled one of these and said they did not send it.
  it('does not attribute a task notification to the person', () => {
    const r = classifyUserText('<task-notification>\n<task-id>bkl8s3c3q</task-id>\n</task-notification>')
    expect(r.kind).toBe('system')
    expect(r).not.toHaveProperty('text')
  })

  it('never carries the BODY of a system entry', () => {
    // A <system-reminder> can be the whole of CLAUDE.md. The note names the kind; the body is gone.
    const huge = `<system-reminder>${'x'.repeat(50_000)}</system-reminder>`
    const r = classifyUserText(huge)
    expect(r).toEqual({ kind: 'system', note: 'system reminder' })
    expect(JSON.stringify(r).length).toBeLessThan(120)
  })

  it('treats every measured system envelope as system', () => {
    for (const tag of [
      'task-notification', 'system-reminder', 'local-command-caveat',
      'local-command-stdout', 'bash-stdout', 'bash-stderr',
    ]) {
      expect(classifyUserText(`<${tag}>body</${tag}>`).kind).toBe('system')
    }
  })

  it('UNWRAPS the envelopes the person really did perform', () => {
    // Dropping these would erase a turn that happened — the user did run the command.
    expect(classifyUserText('<command-name>/commit</command-name>'))
      .toEqual({ kind: 'person', text: '/commit' })
    expect(classifyUserText('<bash-input>ls -la</bash-input>'))
      .toEqual({ kind: 'person', text: 'ls -la' })
  })

  it('unwraps a slash command spread across several envelope tags', () => {
    const r = classifyUserText('<command-name>/review</command-name>\n<command-args>PR 314</command-args>')
    expect(r).toEqual({ kind: 'person', text: '/review\n\nPR 314' })
  })

  it('an unrecognised tag stays the person’s — the safe direction', () => {
    // A message that merely starts with `<` is theirs. A new envelope wrongly shown is the
    // behaviour that already shipped; a real message wrongly hidden is gone.
    expect(classifyUserText('<Foo /> renders twice, why?'))
      .toEqual({ kind: 'person', text: '<Foo /> renders twice, why?' })
    expect(classifyUserText('<diff>\n- a\n+ b\n</diff>').kind).toBe('person')
  })

  it('an empty entry is not an empty bubble under someone’s avatar', () => {
    expect(classifyUserText('   ').kind).toBe('system')
    expect(classifyUserText('<bash-input>   </bash-input>').kind).toBe('system')
  })
})
