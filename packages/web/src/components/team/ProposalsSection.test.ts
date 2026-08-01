import { describe, it, expect } from 'bun:test'
import { NO_REPO_KEY } from '@agentistics/core'
import { describeSources, proposalAge, PROPOSAL_STALE_MS } from './ProposalsSection'
import { NOTIFICATION_TEXT, resolveNotification } from '../../lib/notifications'

describe('describeSources', () => {
  it('shows short repo names, never a raw sentinel', () => {
    const line = describeSources([
      { type: 'repo', value: 'github.com/acme/api' },
      { type: 'none', value: '' },
    ], 'en')
    expect(line).toBe('acme/api, no linked repository')
    expect(line).not.toContain(NO_REPO_KEY)
  })

  it('folds a repo source that literally holds the no-repo sentinel', () => {
    expect(describeSources([{ type: 'repo', value: NO_REPO_KEY }], 'en')).toBe('no linked repository')
  })

  it('shows a project path as itself', () => {
    expect(describeSources([{ type: 'project', value: '/home/me/work' }], 'en')).toBe('/home/me/work')
  })

  it('says "nothing" for an empty rule set in both languages', () => {
    expect(describeSources([], 'en')).toBe('nothing')
    expect(describeSources([], 'pt')).toBe('nada')
  })
})

describe('the new notification codes', () => {
  for (const code of ['member.rules_proposed', 'member.peer_key_changed']) {
    it(`${code} is localized in both languages`, () => {
      for (const lang of ['en', 'pt'] as const) {
        const entry = NOTIFICATION_TEXT[code]![lang]
        expect(entry.title.length).toBeGreaterThan(0)
        expect(entry.message!.length).toBeGreaterThan(0)
      }
    })
  }

  it('interpolates the machine name and the central, leaving no raw placeholder', () => {
    const text = resolveNotification(
      { id: '1', type: 'info', code: 'member.rules_proposed', meta: { name: 'laptop-a', count: 2, central: 'acme:48080' }, ts: 0, read: false },
      'en',
    )
    expect(text.message).toContain('laptop-a')
    expect(text.message).toContain('acme:48080')
    expect(text.message).toContain('2')
    expect(text.message).not.toContain('{')
  })

  it('says plainly that nothing changed on this machine — the propose-never-apply promise', () => {
    expect(NOTIFICATION_TEXT['member.rules_proposed']!.en.message).toContain('Nothing changed here')
    expect(NOTIFICATION_TEXT['member.peer_key_changed']!.en.message).toContain('Nothing was decrypted')
  })
})

describe('proposalAge — the one cue against a withheld-then-delivered envelope', () => {
  const NOW = Date.parse('2026-07-31T12:00:00.000Z')

  it('reads a fresh proposal as recent and not stale', () => {
    expect(proposalAge('2026-07-31T11:40:00.000Z', NOW, 'en')).toEqual({ text: 'just now', stale: false })
  })

  it('counts hours, then days', () => {
    expect(proposalAge('2026-07-31T09:00:00.000Z', NOW, 'en').text).toBe('3h ago')
    expect(proposalAge('2026-07-28T12:00:00.000Z', NOW, 'en').text).toBe('3 day(s) ago')
  })

  it('flags anything past the staleness threshold', () => {
    expect(proposalAge(new Date(NOW - PROPOSAL_STALE_MS - 1).toISOString(), NOW, 'en').stale).toBe(true)
    expect(proposalAge(new Date(NOW - PROPOSAL_STALE_MS + 1000).toISOString(), NOW, 'en').stale).toBe(false)
  })

  it('treats an unreadable timestamp as stale, never as "just now"', () => {
    expect(proposalAge('whenever', NOW, 'en')).toEqual({ text: '', stale: true })
  })

  it('is localized', () => {
    expect(proposalAge('2026-07-31T11:59:00.000Z', NOW, 'pt').text).toBe('agora mesmo')
  })
})

describe('the peer-pinned notification', () => {
  it('is localized in both languages and names the machine', () => {
    for (const lang of ['en', 'pt'] as const) {
      expect(NOTIFICATION_TEXT['member.peer_pinned']![lang].message!.length).toBeGreaterThan(0)
    }
    const text = resolveNotification(
      { id: '1', type: 'warning', code: 'member.peer_pinned', meta: { count: 1, name: 'Laptop B', central: 'acme' }, ts: 0, read: false },
      'en',
    )
    expect(text.message).toContain('Laptop B')
    expect(text.message).not.toContain('{')
  })
})
