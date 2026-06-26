import { describe, test, expect } from 'bun:test'
import { splitInlinedHistory } from './SessionDrilldownModal'

describe('splitInlinedHistory', () => {
  test('returns single turn unchanged when no inlined pattern', () => {
    const result = splitInlinedHistory('user', 'Hello, how are you?')
    expect(result).toEqual([{ role: 'user', content: 'Hello, how are you?' }])
  })

  test('returns assistant message unchanged', () => {
    const result = splitInlinedHistory('assistant', 'User: something\nAssistant: reply')
    expect(result).toEqual([{ role: 'assistant', content: 'User: something\nAssistant: reply' }])
  })

  test('splits inlined history blob into separate turns', () => {
    const blob = 'User: oi\nAssistant: Olá! Como posso ajudar?\nUser: qual modelo você usa?'
    const result = splitInlinedHistory('user', blob)
    expect(result).toEqual([
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'Olá! Como posso ajudar?' },
      { role: 'user', content: 'qual modelo você usa?' },
    ])
  })

  test('handles Gemini label as assistant turn', () => {
    const blob = 'User: hello\nGemini: Hi there!'
    const result = splitInlinedHistory('user', blob)
    expect(result).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'Hi there!' },
    ])
  })

  test('handles Copilot label as assistant turn', () => {
    const blob = 'User: explain this\nCopilot: Sure, here is an explanation.'
    const result = splitInlinedHistory('user', blob)
    expect(result).toEqual([
      { role: 'user', content: 'explain this' },
      { role: 'assistant', content: 'Sure, here is an explanation.' },
    ])
  })

  test('normal message containing the word "User:" inline does not trigger split', () => {
    // Only splits on \n followed by a label — not mid-sentence occurrences
    const normal = 'The User: settings panel is on the left'
    const result = splitInlinedHistory('user', normal)
    expect(result).toEqual([{ role: 'user', content: normal }])
  })
})
