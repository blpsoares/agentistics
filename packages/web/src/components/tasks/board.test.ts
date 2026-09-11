import { describe, expect, it } from 'bun:test'
import { capList } from './board'

describe('capList', () => {
  it('shows everything and reports no extra when the list already fits', () => {
    expect(capList(['claude', 'codex'], 4)).toEqual({ shown: ['claude', 'codex'], extra: 0 })
  })

  it('caps at max and reports the truthful remainder — this is the Repositories bug', () => {
    // Six harnesses, capped at 4: the column must draw 4 pills plus a "+2", never all six.
    const all = ['claude', 'codex', 'gemini', 'copilot', 'antigravity', 'kimi']
    expect(capList(all, 4)).toEqual({ shown: ['claude', 'codex', 'gemini', 'copilot'], extra: 2 })
  })

  it('an empty list stays empty with no extra', () => {
    expect(capList([], 4)).toEqual({ shown: [], extra: 0 })
  })

  it('never returns fewer than 1 slot even if max is given as 0 or negative', () => {
    expect(capList(['a', 'b'], 0)).toEqual({ shown: ['a'], extra: 1 })
    expect(capList(['a', 'b'], -3)).toEqual({ shown: ['a'], extra: 1 })
  })

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c']
    const { shown } = capList(input, 2)
    shown.push('z')
    expect(input).toEqual(['a', 'b', 'c'])
  })
})
