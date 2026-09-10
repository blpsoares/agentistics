import { describe, expect, test } from 'bun:test'
import { sessionTaskLink, taskPath } from './sessionTaskLink'

describe('the parent delivery, on the session metrics card', () => {
  test('a filed session with somewhere to go is a LINK', () => {
    expect(sessionTaskLink('O terminal na sessão', true)).toEqual({
      kind: 'link', title: 'O terminal na sessão', path: '/tasks/O%20terminal%20na%20sess%C3%A3o',
    })
  })

  test('a filed session with nowhere to go is NAMED, not offered', () => {
    // The same rule `onOpenFull` keeps in this card: on a surface with nothing to open, the link is
    // ABSENT rather than inert. But the NAME is still worth saying — knowing which delivery this
    // session belongs to is the answer even where you cannot navigate to it.
    expect(sessionTaskLink('ALM board', false)).toEqual({ kind: 'label', title: 'ALM board' })
  })

  test('a session filed under nothing draws NOTHING — never a dash, never an empty row', () => {
    expect(sessionTaskLink(undefined, true)).toEqual({ kind: 'none' })
    expect(sessionTaskLink('', true)).toEqual({ kind: 'none' })
    expect(sessionTaskLink('   ', true)).toEqual({ kind: 'none' })
  })
})

describe('the path is built from a TITLE, and a title is not a path', () => {
  test('a title carrying a slash does not become two segments', () => {
    // `feat/x` would route to `/tasks/feat/x`, which matches nothing — the board's route is one
    // segment. Every other caller in this app already encodes; this is the same rule, tested.
    expect(taskPath('feat/session-shell')).toBe('/tasks/feat%2Fsession-shell')
  })

  test('and neither do the other characters a person types into a title', () => {
    expect(taskPath('50% & rising')).toBe('/tasks/50%25%20%26%20rising')
    expect(taskPath('a?b#c')).toBe('/tasks/a%3Fb%23c')
  })

  test('the title is passed through as the REF, which the server resolves by name', () => {
    // `findTask` tries id, then exact title, then case-insensitively — so the title the fleet row
    // carries is a ref the board accepts. That is why no id lookup is needed to build this link.
    expect(taskPath('t-a68ee45199')).toBe('/tasks/t-a68ee45199')
  })
})
