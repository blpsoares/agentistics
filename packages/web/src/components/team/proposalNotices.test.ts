import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COPY } from './copy'
import { NO_REPO_KEY } from '@agentistics/core'
import { describeSources, proposalAge, peerLabel, PROPOSAL_STALE_MS } from './proposalNotices'
import { noticeSummary, proposalPlan, nextNoticeFocus, noticeFocusSeq } from './proposalNotices'
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
    expect(peerLabel({ machineId: 'a'.repeat(64), machineName: 'Laptop B', fingerprint: 'x' }, 'en')).toBe('Laptop B')
  })

  it('never falls back to the machine id — that is sha256(token), not a name', () => {
    // "If you do not recognise a machine, compare its fingerprint" asks nothing of a user shown a
    // token-hash prefix, and the id is another machine's internals on this machine's card.
    expect(peerLabel({ machineId: 'abcdef0123456789', machineName: '', fingerprint: 'x' }, 'en'))
      .toBe('Unnamed machine')
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

  it('renders the two lists with the two different sentences — never one for both', () => {
    // `stopsSharing` may say "stops sharing"; `partlyRestricts` may only say "no longer listed",
    // because sessions in those rows can still ship through the other dimension.
    expect(src).toMatch(/COPY\.proposalWouldHide\[lang\][\s\S]{0,200}plan\.stopsSharing/)
    expect(src).toMatch(/COPY\.proposalPartlyRestricts\[lang\][\s\S]{0,200}plan\.partlyRestricts/)
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
    'proposalWouldWiden', 'proposalWidensUnlisted', 'proposalHidesUnlisted', 'proposalPartlyRestricts',
    'peersCount', 'peersShow',
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

describe('nextNoticeFocus — the bell must open the notices EVERY time, not once', () => {
  it('a second request for the SAME connection is a new request', () => {
    // The bug the owner hit: the panel stored the focused connection id and nothing ever cleared
    // it, so the card's "focused?" prop went true once and stayed true. Clicking the bell again
    // changed no state anywhere — no re-render, no effect, no modal. A deep link is an EVENT; a
    // latched boolean cannot represent the second one.
    const first = nextNoticeFocus(null, 'c_1')
    const second = nextNoticeFocus(first, 'c_1')
    expect(second.connId).toBe('c_1')
    expect(second.seq).toBeGreaterThan(first.seq)
  })

  it('switching connections is a new request too', () => {
    const a = nextNoticeFocus(null, 'c_1')
    const b = nextNoticeFocus(a, 'c_2')
    expect(b.connId).toBe('c_2')
    expect(b.seq).toBeGreaterThan(a.seq)
  })

  it('a card is focused only when the request names it', () => {
    const req = nextNoticeFocus(null, 'c_1')
    expect(noticeFocusSeq(req, 'c_1')).toBe(req.seq)
    expect(noticeFocusSeq(req, 'c_2')).toBe(0)
    expect(noticeFocusSeq(null, 'c_1')).toBe(0)
  })

  it('the whole notification row is the link, not a box inside it', () => {
    // A row that navigates must be clickable across its own surface: the handler used to sit on an
    // inner `flex: 1` div, so the row's padding, its icon and the timestamp column did nothing.
    const src = readFileSync(join(import.meta.dir, '../NotificationBell.tsx'), 'utf8')
    const rowStart = src.indexOf('notes.map(n =>')
    const row = src.slice(rowStart, src.indexOf('</div>', src.indexOf('<Icon')))
    expect(row).toContain('onClick={link ? go : undefined}')
    // …and the per-row delete button must not navigate on its way out.
    expect(src).toContain('stopPropagation')
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

describe('another machine\'s id is never shown', () => {
  it('peerLabel says "unnamed machine" instead of a slice of sha256(token)', () => {
    const id = 'a'.repeat(64)
    const label = peerLabel({ machineId: id, machineName: '', fingerprint: 'ab cd' }, 'en')
    expect(label).not.toContain(id.slice(0, 8))
    expect(label).toBe('Unnamed machine')
    expect(peerLabel({ machineId: id, machineName: '', fingerprint: 'x' }, 'pt')).toBe('Máquina sem nome')
  })

  it('still prefers the name the central gave it', () => {
    expect(peerLabel({ machineId: 'x', machineName: 'Laptop B', fingerprint: 'y' }, 'en')).toBe('Laptop B')
  })

  it('the peers surface renders no machineId as text — only as a React key', () => {
    const src = readFileSync(join(import.meta.dir, 'PeersSection.tsx'), 'utf8')
    let occurrences = 0
    for (const m of src.matchAll(/machineId/g)) {
      occurrences++
      const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index))
      // The ONLY admissible use: it identifies the row to React. Never a rendered value.
      expect(`${line.trim()}|${/\bkey[=:]\s*[^,]*machineId/.test(line)}`).toBe(`${line.trim()}|true`)
    }
    // Not vacuous: the file does still use the id (as the key), so the loop has something to check.
    expect(occurrences).toBeGreaterThan(0)
    expect(src).not.toMatch(/title=\{[^}]*machineId/)
    expect(src).not.toMatch(/aria-label=\{[^}]*machineId/)
  })

  it('the fingerprint column is monospaced and tabular, so two of them can be compared by eye', () => {
    const src = readFileSync(join(import.meta.dir, 'PeersSection.tsx'), 'utf8')
    expect(src).toContain('tabular-nums')
    expect(src).toContain('monospace')
    // A table, not a run-on line per machine.
    expect(src).toContain('<table')
    expect(src).not.toContain('<ul')
  })
})

describe('an unnamed machine is said in words, everywhere it is named', () => {
  it('the bell fills {name} with words, never a raw placeholder and never an id', () => {
    for (const code of ['member.rules_proposed', 'member.peer_pinned', 'member.peer_key_changed']) {
      for (const lang of ['en', 'pt'] as const) {
        const text = resolveNotification(
          { id: '1', type: 'info', code, meta: { central: 'acme', count: 1 }, ts: 0, read: false },
          lang,
        )
        expect(`${code}|${lang}|${text.message!.includes('{name}')}`).toBe(`${code}|${lang}|false`)
        expect(text.message).toContain(lang === 'pt' ? 'sem nome' : 'unnamed machine')
      }
    }
  })

  it('the modal and the reverse-warning badge fall back to the same words', () => {
    const modal = readFileSync(join(import.meta.dir, 'NoticesModal.tsx'), 'utf8')
    expect(modal).toContain('w.machineName || COPY.peerUnnamed[lang]')
    expect(modal).toContain('p.fromMachineName || COPY.peerUnnamed[lang]')
    const badge = readFileSync(join(import.meta.dir, 'SiblingWithheldBadge.tsx'), 'utf8')
    expect(badge).toContain('m.name || COPY.peerUnnamed[lang]')
  })

  for (const key of ['peerUnnamed', 'peersColMachine', 'peersColFingerprint'] as const) {
    it(`${key} exists in EN and PT`, () => {
      expect(COPY[key].en.length).toBeGreaterThan(0)
      expect(COPY[key].pt.length).toBeGreaterThan(0)
      expect(COPY[key].en).not.toBe(COPY[key].pt)
    })
  }
})
