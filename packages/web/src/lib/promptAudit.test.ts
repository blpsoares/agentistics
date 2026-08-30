import { describe, it, expect } from 'bun:test'
import {
  buildAuditEntry,
  appendAudit,
  auditForSession,
  resolveAuthor,
  parseStoredAudit,
  MAX_AUDIT_ENTRIES,
  MAX_AUDIT_TEXT,
  type PromptAuditEntry,
  type PromptAuditInput,
} from './promptAudit'

const INPUT: PromptAuditInput = {
  author: 'op-abc123',
  sessionId: 'agentop-3f5f',
  sessionTitle: 'COORDENADOR',
  harness: 'claude',
  text: 'please run the tests',
  ok: true,
  message: 'Prompt sent to agentop-3f5f.',
}

const NOW = new Date('2026-08-30T12:34:56.000Z')

describe('buildAuditEntry', () => {
  it('captures who / which session / what / when and the outcome', () => {
    const e = buildAuditEntry(INPUT, NOW, 'id-1')
    expect(e).toEqual({
      id: 'id-1',
      at: '2026-08-30T12:34:56.000Z',
      author: 'op-abc123',
      sessionId: 'agentop-3f5f',
      sessionTitle: 'COORDENADOR',
      harness: 'claude',
      text: 'please run the tests',
      ok: true,
      message: 'Prompt sent to agentop-3f5f.',
    })
  })

  it('records a FAILED send just as faithfully as a success', () => {
    const e = buildAuditEntry({ ...INPUT, ok: false, message: 'Could not send to agentop-3f5f.' }, NOW, 'id-2')
    expect(e.ok).toBe(false)
    expect(e.message).toBe('Could not send to agentop-3f5f.')
  })

  it('trims the text and caps a pasted blob', () => {
    const e = buildAuditEntry({ ...INPUT, text: `  hello  ` }, NOW, 'id-3')
    expect(e.text).toBe('hello')
    const big = buildAuditEntry({ ...INPUT, text: 'x'.repeat(MAX_AUDIT_TEXT + 500) }, NOW, 'id-4')
    expect(big.text.length).toBe(MAX_AUDIT_TEXT)
  })

  it('never records a blank author', () => {
    const e = buildAuditEntry({ ...INPUT, author: '   ' }, NOW, 'id-5')
    expect(e.author).toBe('unknown')
  })
})

describe('appendAudit', () => {
  const entry = (id: string): PromptAuditEntry => buildAuditEntry({ ...INPUT, text: id }, NOW, id)

  it('prepends newest-first without mutating the input', () => {
    const a = [entry('a')]
    const b = appendAudit(a, entry('b'))
    expect(b.map(e => e.id)).toEqual(['b', 'a'])
    expect(a.map(e => e.id)).toEqual(['a']) // input untouched
  })

  it('caps the log, dropping the oldest', () => {
    let list: PromptAuditEntry[] = []
    for (let i = 0; i < MAX_AUDIT_ENTRIES + 10; i++) list = appendAudit(list, entry(`e${i}`))
    expect(list.length).toBe(MAX_AUDIT_ENTRIES)
    // newest first, so the first entry is the last appended and the oldest ones fell off
    expect(list[0]?.id).toBe(`e${MAX_AUDIT_ENTRIES + 9}`)
    expect(list.some(e => e.id === 'e0')).toBe(false)
  })
})

describe('auditForSession', () => {
  it('returns only the records for one session, in order', () => {
    const list = [
      buildAuditEntry({ ...INPUT, sessionId: 'b' }, NOW, '3'),
      buildAuditEntry({ ...INPUT, sessionId: 'a' }, NOW, '2'),
      buildAuditEntry({ ...INPUT, sessionId: 'b' }, NOW, '1'),
    ]
    expect(auditForSession(list, 'b').map(e => e.id)).toEqual(['3', '1'])
    expect(auditForSession(list, 'a').map(e => e.id)).toEqual(['2'])
    expect(auditForSession(list, 'zzz')).toEqual([])
  })
})

describe('resolveAuthor', () => {
  it('prefers an IAM display name when the dashboard has one', () => {
    expect(resolveAuthor({ accountName: 'Ada Lovelace', operatorId: 'op-1' })).toBe('Ada Lovelace')
  })
  it('falls back to the browser operator id when there is no account', () => {
    expect(resolveAuthor({ accountName: null, operatorId: 'op-1' })).toBe('op-1')
    expect(resolveAuthor({ accountName: '   ', operatorId: 'op-1' })).toBe('op-1')
    expect(resolveAuthor({ operatorId: 'op-1' })).toBe('op-1')
  })
})

describe('parseStoredAudit', () => {
  it('reads a well-formed stored log', () => {
    const stored = JSON.stringify([buildAuditEntry(INPUT, NOW, 'id-1')])
    expect(parseStoredAudit(stored).map(e => e.id)).toEqual(['id-1'])
  })
  it('treats null / junk / wrong-shape as an empty log rather than throwing', () => {
    expect(parseStoredAudit(null)).toEqual([])
    expect(parseStoredAudit('not json')).toEqual([])
    expect(parseStoredAudit('{"not":"an array"}')).toEqual([])
    expect(parseStoredAudit('[{"id":"x"}]')).toEqual([]) // missing required fields
  })
})
