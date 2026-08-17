import { describe, expect, test } from 'bun:test'
import { metricsReasonText, serviceBadge, serviceNote, sessionsEmptyNotice } from './hardwareNotice'

describe('hardwareNotice', () => {
  test('an unknown state never reads as stopped, in either language', () => {
    expect(serviceBadge('unknown', 'en').tone).toBe('unknown')
    expect(serviceBadge('unknown', 'pt').tone).toBe('unknown')
    expect(serviceBadge('unknown', 'en').label).not.toBe(serviceBadge('stopped', 'en').label)
  })

  test('a server too old to send a state is unknown, not off', () => {
    expect(serviceBadge(undefined, 'en').tone).toBe('unknown')
  })

  test('an in-process daemon explains where its CPU and memory went', () => {
    const note = serviceNote({ state: 'running', hosting: 'in-process', serverName: 'agentop server' }, 'en')
    expect(note).toContain('agentop server')
    expect(serviceNote({ state: 'running', hosting: 'in-process', serverName: 'agentop server' }, 'pt'))
      .toContain('agentop server')
  })

  test('a running daemon of its own gets no excuse note', () => {
    expect(serviceNote({ state: 'running', hosting: 'separate', serverName: 'agentop server' }, 'en')).toBeNull()
  })

  test('an empty fleet says which of the three empties it is', () => {
    const real = sessionsEmptyNotice({ count: 0, lang: 'en' })
    const blocked = sessionsEmptyNotice({ count: 0, unavailable: 'backend-unavailable', unavailableDetail: 'use WSL', lang: 'en' })
    const failed = sessionsEmptyNotice({ count: 0, unavailable: 'read-failed', lang: 'en' })
    expect(real?.title).not.toBe(blocked?.title)
    expect(blocked?.detail).toBe('use WSL')
    expect(failed?.detail).toContain('not the same as there being none')
  })

  test('a non-empty fleet has no notice at all', () => {
    expect(sessionsEmptyNotice({ count: 2, lang: 'en' })).toBeNull()
    expect(sessionsEmptyNotice({ count: 2, unavailable: 'read-failed', lang: 'en' })).toBeNull()
  })

  test('every metrics reason has a sentence, and no reason has none', () => {
    for (const r of ['no-proc', 'no-pid', 'first-sample'] as const) {
      expect(metricsReasonText(r, 'en')).toBeTruthy()
      expect(metricsReasonText(r, 'pt')).toBeTruthy()
    }
    expect(metricsReasonText(undefined, 'en')).toBeNull()
  })
})
