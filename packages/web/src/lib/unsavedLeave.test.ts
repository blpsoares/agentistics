import { beforeEach, describe, expect, test } from 'bun:test'
import {
  guardNavigator, navigationKeepsStudio, pathnameOf, unsavedLeaveText, type GuardableNavigator,
} from './unsavedLeave'
import { answerUnsaved, getUnsaved, holdIfUnsaved, reportUnsaved, resetUnsaved } from './unsavedBuffers'

beforeEach(() => resetUnsaved())

describe('navigationKeepsStudio', () => {
  const keys = ['agentop-3f5f', 'c0nv-id']
  test('the same session page, by either id, keeps it', () => {
    expect(navigationKeepsStudio('/sessions/agentop-3f5f', keys)).toBe(true)
    expect(navigationKeepsStudio('/sessions/c0nv-id/', keys)).toBe(true)
    expect(navigationKeepsStudio(`/sessions/${encodeURIComponent('agentop-3f5f')}`, keys)).toBe(true)
  })
  test('another session, the overview, the dedicated terminal and any other screen drop it', () => {
    expect(navigationKeepsStudio('/sessions/other', keys)).toBe(false)
    expect(navigationKeepsStudio('/sessions', keys)).toBe(false)
    expect(navigationKeepsStudio('/sessions/agentop-3f5f/terminal', keys)).toBe(false)
    expect(navigationKeepsStudio('/tasks', keys)).toBe(false)
    expect(navigationKeepsStudio('/', keys)).toBe(false)
  })
  test('a malformed escape is not a match', () => {
    expect(navigationKeepsStudio('/sessions/%E0%A4%A', keys)).toBe(false)
  })
})

describe('pathnameOf', () => {
  test('a resolved path object, a string with a query, and a query-only string', () => {
    expect(pathnameOf({ pathname: '/tasks', search: '?x', hash: '' }, '/sessions/a')).toBe('/tasks')
    expect(pathnameOf('/sessions/a?view=chat', '/x')).toBe('/sessions/a')
    expect(pathnameOf('?view=terminal', '/sessions/a')).toBe('/sessions/a')
  })
})

/** A history-shaped fake: `push`/`replace` record where they went and never use `this`. */
function fakeHistory() {
  const went: string[] = []
  const nav = {
    push: (to: { pathname: string }) => { went.push(`push ${to.pathname}`) },
    replace: (to: { pathname: string }) => { went.push(`replace ${to.pathname}`) },
  }
  return { nav: nav as unknown as GuardableNavigator, went, raw: nav }
}

describe('guardNavigator, wired to the unsaved store the way the page wires it', () => {
  const arm = (nav: GuardableNavigator, keys: string[]) => guardNavigator(
    nav,
    to => !navigationKeepsStudio(pathnameOf(to, '/sessions/s1'), keys),
    run => holdIfUnsaved('leave', run),
  )

  test('with nothing unsaved every navigation passes straight through', () => {
    const h = fakeHistory()
    arm(h.nav, ['s1'])
    h.raw.push({ pathname: '/tasks' })
    expect(h.went).toEqual(['push /tasks'])
  })

  test('with a dirty buffer, leaving is HELD — the history does not move until the reader discards', () => {
    const h = fakeHistory()
    arm(h.nav, ['s1'])
    reportUnsaved('studio', ['README.md'])
    h.raw.push({ pathname: '/tasks' })
    expect(h.went).toEqual([])
    expect(getUnsaved().question).toEqual({ cause: 'leave' })
    answerUnsaved(true)
    expect(h.went).toEqual(['push /tasks'])
  })

  test('keeping editing leaves the history where it was', () => {
    const h = fakeHistory()
    arm(h.nav, ['s1'])
    reportUnsaved('studio', ['README.md'])
    h.raw.replace({ pathname: '/sessions/other' })
    answerUnsaved(false)
    expect(h.went).toEqual([])
  })

  test('a navigation that keeps this session page (the ?view= switch) is never held', () => {
    const h = fakeHistory()
    arm(h.nav, ['s1'])
    reportUnsaved('studio', ['README.md'])
    h.raw.replace({ pathname: '/sessions/s1' })
    expect(h.went).toEqual(['replace /sessions/s1'])
    expect(getUnsaved().question).toBeNull()
  })

  test('proceeding goes through the ORIGINAL method, so it cannot be held by its own guard', () => {
    const h = fakeHistory()
    arm(h.nav, ['s1'])
    reportUnsaved('studio', ['a'])
    h.raw.push({ pathname: '/tasks' })
    answerUnsaved(true)
    // Still dirty (the page has not unmounted yet) — and the navigation still happened once.
    expect(getUnsaved().files).toEqual(['a'])
    expect(h.went).toEqual(['push /tasks'])
  })

  test('restore puts the originals back, and never clobbers a newer wrapper', () => {
    const h = fakeHistory()
    const original = h.nav.push
    const restoreA = arm(h.nav, ['s1'])
    const wrapperA = h.nav.push
    const restoreB = arm(h.nav, ['s1'])
    const wrapperB = h.nav.push
    restoreA() // out of order: B is on top, so A must not touch it
    expect(h.nav.push).toBe(wrapperB)
    restoreB() // B steps aside to what it wrapped
    expect(h.nav.push).toBe(wrapperA)
    restoreA()
    expect(h.nav.push).toBe(original)
  })
})

describe('unsavedLeaveText', () => {
  test('names the files and says what the confirm does, in both languages', () => {
    const en = unsavedLeaveText(['src/a.ts', 'b.md'], 'close', 'en')
    expect(en.message).toContain('2 files in the Studio')
    expect(en.message).toContain('a.ts, b.md')
    expect(en.confirm).toBe('Close anyway')
    expect(en.cancel).toBe('Keep editing')
    const pt = unsavedLeaveText(['a', 'b', 'c', 'd', 'e'], 'leave', 'pt')
    expect(pt.message).toContain('5 arquivos no Studio')
    expect(pt.message).toContain('a, b, c e mais 2')
    expect(pt.confirm).toBe('Sair mesmo assim')
    expect(unsavedLeaveText(['x'], 'leave', 'en').message).toContain('1 file in the Studio has')
  })
})
