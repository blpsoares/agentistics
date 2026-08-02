import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COPY } from './copy'
import { NO_REPO_KEY } from '@agentistics/core'
import { describeSources, proposalAge, peerLabel, PROPOSAL_STALE_MS } from './proposalNotices'
import { noticeSummary, proposalPlan } from './proposalNotices'
import { NOTIFICATION_TEXT, resolveNotification, notificationLink } from '../../lib/notifications'

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

describe('peerLabel — the fingerprint list must name machines, not hashes', () => {
  it('uses the machine name the central gave it', () => {
    expect(peerLabel({ machineId: 'a'.repeat(64), machineName: 'Laptop B', fingerprint: 'x' })).toBe('Laptop B')
  })

  it('falls back to a short id only when there is genuinely no name', () => {
    // "If you do not recognise a machine, compare its fingerprint" asks nothing of a user who is
    // shown a token-hash prefix, so this is the last resort, not the default.
    expect(peerLabel({ machineId: 'abcdef0123456789', machineName: '', fingerprint: 'x' })).toBe('abcdef012345')
  })
})

describe('noticeSummary — the card\'s notices button', () => {
  it('counts proposals and key warnings together', () => {
    expect(noticeSummary([{}, {}], [{}])).toEqual({ total: 3, proposals: 2, keyWarnings: 1, tone: 'alarm' })
  })

  it('is an alarm only when a key changed; a proposal is a decision', () => {
    expect(noticeSummary([{}], []).tone).toBe('decision')
    expect(noticeSummary([], [{}]).tone).toBe('alarm')
    expect(noticeSummary([], []).tone).toBe('none')
  })

  it('treats a missing list as zero — an older central sends neither', () => {
    expect(noticeSummary(undefined, undefined).total).toBe(0)
  })
})

describe('proposalPlan — what the Apply button actually sends', () => {
  it('never sends the sibling\'s snapshot: this machine\'s own denials survive', () => {
    const conn = { shareMode: 'denylist' as const, sources: [{ type: 'repo' as const, value: 'github.com/acme/secret' }] }
    const plan = proposalPlan(conn, { shareMode: 'denylist', sources: [{ type: 'repo', value: 'github.com/acme/api' }] })
    expect(plan.merged.sources.map(s => s.value).sort())
      .toEqual(['github.com/acme/api', 'github.com/acme/secret'])
    expect(plan.stopsSharing.map(s => s.value)).toEqual(['github.com/acme/api'])
  })

  it('reads a connection with no stored rules as a denylist that denies nothing', () => {
    const plan = proposalPlan({}, { shareMode: 'denylist', sources: [{ type: 'repo', value: 'github.com/acme/api' }] })
    expect(plan.merged).toEqual({ shareMode: 'denylist', sources: [{ type: 'repo', value: 'github.com/acme/api' }] })
  })
})

describe('the notices modal wiring — the regression that started all this', () => {
  const src = readFileSync(join(import.meta.dir, 'NoticesModal.tsx'), 'utf8')

  it('applies the MERGED plan, never the proposal\'s own shareMode/sources', () => {
    expect(src).toContain('onApply(conn.id, plan.merged.shareMode, plan.merged.sources)')
    // The old call. Its return would replace this machine's rules with the sibling's.
    expect(src).not.toContain('onApply(conn.id, p.shareMode, p.sources)')
  })

  it('states the widening case in the warning colour rather than doing it', () => {
    expect(src).toContain('plan.wouldStartSharing')
    expect(src).toContain('plan.widensEverythingUnlisted')
    expect(src).toContain('anthropic-orange')
  })
})

describe('the notices copy', () => {
  for (const key of [
    'noticesBtn', 'noticesTitle', 'noticesEmpty', 'proposalWouldHide', 'proposalNothingToApply',
    'proposalWouldWiden', 'proposalWidensUnlisted', 'proposalHidesUnlisted', 'peersCount', 'peersShow',
  ] as const) {
    it(`${key} exists in EN and PT`, () => {
      expect(COPY[key].en.length).toBeGreaterThan(0)
      expect(COPY[key].pt.length).toBeGreaterThan(0)
      expect(COPY[key].en).not.toBe(COPY[key].pt)
    })
  }

  it('keeps the honesty guards verbatim — nothing changed here, and the best-effort caveat', () => {
    expect(COPY.proposalNotApplied.en).toContain('Nothing has changed on this machine')
    expect(COPY.keyChangedBody.en).toContain('nothing from it was decrypted')
    expect(COPY.siblingWithholdRowProject.en).toContain('a project with this name')
  })
})

describe('notificationLink — a decision must be one click away', () => {
  it('sends the proposal notification to that connection\'s notices', () => {
    expect(notificationLink({ code: 'member.rules_proposed', meta: { connectionId: 'c_1' } }))
      .toBe('/settings/connection?conn=c_1&notices=1')
  })

  it('leads nowhere for news, or for a row persisted before connectionId existed', () => {
    expect(notificationLink({ code: 'member.reconnected', meta: { connectionId: 'c_1' } })).toBeNull()
    expect(notificationLink({ code: 'member.rules_proposed', meta: {} })).toBeNull()
    expect(notificationLink({ code: undefined, meta: undefined })).toBeNull()
  })
})

describe('the decluttered card', () => {
  it('the identity block no longer prints a token row of dots', () => {
    const src = readFileSync(join(import.meta.dir, 'ConnectionIdentity.tsx'), 'utf8')
    expect(src).not.toContain('••••••••')
    // Two columns, not six stacked rows.
    expect(src).toContain('repeat(auto-fit, minmax(150px, 1fr))')
  })

  it('the fingerprints are behind a disclosure, and their explanation travels with them', () => {
    const src = readFileSync(join(import.meta.dir, 'PeersSection.tsx'), 'utf8')
    expect(src).toContain('useState(false)')
    // The explanation sits INSIDE the opened block, never as preamble above the toggle.
    expect(src.indexOf('COPY.peersBody')).toBeGreaterThan(src.indexOf('{open && ('))
  })

  it('the standing caveats fold, but the live OTel warning does not', () => {
    const src = readFileSync(join(import.meta.dir, 'SharedReposPanel.tsx'), 'utf8')
    expect(src).toMatch(/<Caveats[\s\S]*COPY\.ciNote[\s\S]*<\/Caveats>/)
    expect(src.indexOf('COPY.otelWarn')).toBeGreaterThan(src.indexOf('</Caveats>'))
  })
})
