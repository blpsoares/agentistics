import { describe, it, expect } from 'bun:test'
import { NO_REPO_KEY } from '@agentistics/core'
import { describeSources } from './ProposalsSection'
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
