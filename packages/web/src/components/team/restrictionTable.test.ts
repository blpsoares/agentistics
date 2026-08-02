import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NO_REPO_KEY, type SiblingRuleFact } from '@agentistics/core'
import { buildRestrictionTable } from './restrictionTable'

const sibling = (over: Partial<SiblingRuleFact> & { machineId: string }): SiblingRuleFact => ({
  machineName: over.machineId,
  shareMode: 'denylist',
  sources: [],
  at: '2026-07-31T10:00:00.000Z',
  receivedAt: '2026-07-31T10:00:05.000Z',
  ...over,
})

describe('buildRestrictionTable — rows are what is NOT shared, and where', () => {
  it('names every machine that withholds a repository, this one included', () => {
    const table = buildRestrictionTable({
      self: { shareMode: 'denylist', sources: [{ type: 'repo', value: 'github.com/acme/api' }] },
      selfLabel: 'This machine',
      siblings: [
        sibling({ machineId: 'm1', machineName: 'Alienware', sources: [{ type: 'repo', value: 'github.com/acme/api' }] }),
        sibling({ machineId: 'm2', machineName: 'Laptop B', sources: [] }),
      ],
    })
    const row = table.rows.find(r => r.value === 'github.com/acme/api')!
    expect(row).toBeDefined()
    expect(row.selfRestricts).toBe(true)
    expect(row.restrictedBy.map(m => m.machineName)).toEqual(['This machine', 'Alienware'])
    // …and the machines that still share it, which is the other half of the question.
    expect(row.sharedBy.map(m => m.machineName)).toEqual(['Laptop B'])
  })

  it('a repository only a SIBLING hides is a row, and it is the actionable one', () => {
    const table = buildRestrictionTable({
      self: { shareMode: 'denylist', sources: [] },
      selfLabel: 'This machine',
      siblings: [sibling({ machineId: 'm1', machineName: 'Alienware', sources: [{ type: 'repo', value: 'github.com/acme/secret' }] })],
    })
    expect(table.rows).toHaveLength(1)
    const row = table.rows[0]!
    expect(row.kind).toBe('repo')
    expect(row.selfRestricts).toBe(false)
    expect(row.applicable).toBe(true)
    expect(row.source).toEqual({ type: 'repo', value: 'github.com/acme/secret' })
  })

  it('a repository nobody withholds is not a row — the table is what is HIDDEN', () => {
    const table = buildRestrictionTable({
      self: { shareMode: 'allowlist', sources: [{ type: 'repo', value: 'github.com/acme/api' }] },
      selfLabel: 'This machine',
      siblings: [sibling({ machineId: 'm1', shareMode: 'allowlist', sources: [{ type: 'repo', value: 'github.com/acme/api' }] })],
    })
    expect(table.rows).toEqual([])
  })

  it('the unattributed bucket is a row like any other, never a raw sentinel', () => {
    const table = buildRestrictionTable({
      self: { shareMode: 'denylist', sources: [{ type: 'none', value: '' }] },
      selfLabel: 'This machine',
      siblings: [],
    })
    expect(table.rows.map(r => r.kind)).toEqual(['none'])
    expect(table.rows[0]!.value).toBe(NO_REPO_KEY)
  })

  it('a project a sibling hides is matched by FOLDER NAME and carries the sibling\'s own path', () => {
    const table = buildRestrictionTable({
      self: { shareMode: 'denylist', sources: [] },
      selfLabel: 'This machine',
      siblings: [sibling({
        machineId: 'm1', machineName: 'Alienware',
        sources: [{ type: 'project', value: 'C:\\Users\\me\\projFicticio' }],
      })],
      localProjects: ['/home/me/work/projFicticio'],
    })
    const row = table.rows[0]!
    expect(row.kind).toBe('project')
    expect(row.restrictedBy[0]!.paths).toEqual(['C:\\Users\\me\\projFicticio'])
    // Acting on it here must name THIS machine's path, never the sibling's — a rule is exact.
    expect(row.source).toEqual({ type: 'project', value: '/home/me/work/projFicticio' })
    expect(row.applicable).toBe(true)
  })

  it('a project this machine does not have is a fact, not an action', () => {
    const table = buildRestrictionTable({
      self: { shareMode: 'denylist', sources: [] },
      selfLabel: 'This machine',
      siblings: [sibling({ machineId: 'm1', sources: [{ type: 'project', value: '/elsewhere/only-there' }] })],
      localProjects: ['/home/me/other'],
    })
    const row = table.rows[0]!
    expect(row.source).toBeNull()
    expect(row.applicable).toBe(false)
    // The row still exists: "that machine withholds this" is true regardless.
    expect(row.restrictedBy).toHaveLength(1)
  })

  it('an ambiguous folder name is never guessed at', () => {
    const table = buildRestrictionTable({
      self: { shareMode: 'denylist', sources: [] },
      selfLabel: 'This machine',
      siblings: [sibling({ machineId: 'm1', sources: [{ type: 'project', value: '/sib/api' }] })],
      localProjects: ['/home/me/a/api', '/home/me/b/api'],
    })
    expect(table.rows[0]!.source).toBeNull()
  })

  it('a row this machine already restricts offers no apply', () => {
    const table = buildRestrictionTable({
      self: { shareMode: 'denylist', sources: [{ type: 'repo', value: 'github.com/acme/api' }] },
      selfLabel: 'This machine',
      siblings: [sibling({ machineId: 'm1', sources: [{ type: 'repo', value: 'github.com/acme/api' }] })],
    })
    expect(table.rows[0]!.applicable).toBe(false)
  })

  it('actionable rows come first — they are the only ones with a decision in them', () => {
    const table = buildRestrictionTable({
      self: { shareMode: 'denylist', sources: [{ type: 'repo', value: 'github.com/acme/aaa' }] },
      selfLabel: 'This machine',
      siblings: [sibling({
        machineId: 'm1',
        sources: [{ type: 'repo', value: 'github.com/acme/aaa' }, { type: 'repo', value: 'github.com/acme/zzz' }],
      })],
    })
    expect(table.rows.map(r => r.value)).toEqual(['github.com/acme/zzz', 'github.com/acme/aaa'])
  })

  it('names the machines that share only what they list — the rows cannot say it for them', () => {
    // An allowlist machine withholds everything NOT named, which is not expressible as rows: the
    // table can only ever hold buckets somebody named. Said in words instead of implied by silence.
    const table = buildRestrictionTable({
      self: { shareMode: 'denylist', sources: [] },
      selfLabel: 'This machine',
      siblings: [
        sibling({ machineId: 'm1', machineName: 'Alienware', shareMode: 'allowlist', sources: [{ type: 'repo', value: 'github.com/acme/api' }] }),
        sibling({ machineId: 'm2', machineName: 'Laptop B', shareMode: 'denylist', sources: [] }),
      ],
    })
    expect(table.allowlistMachines.map(m => m.machineName)).toEqual(['Alienware'])
  })

  it('the modal renders the table, not a card per proposal', () => {
    const src = readFileSync(join(import.meta.dir, 'NoticesModal.tsx'), 'utf8')
    expect(src).toContain('buildRestrictionTable')
    expect(src).toContain('COPY.colRestrictedOn[lang]')
    // A phone gets stacked rows, never a table scrolling the page sideways.
    expect(src).toContain('isMobile ?')
    expect(src).toContain("overflowX: 'auto'")
    // The honesty guards the table does not make redundant.
    expect(src).toContain('COPY.siblingWithholdBestEffort[lang]')
    expect(src).toContain('COPY.proposalNotApplied[lang]')
    expect(src).toContain('COPY.proposalStale[lang]')
    expect(src).toContain('plan.wouldStartSharing')
    // …and the sentence that is gone for good: a dead proposal is no longer shown at all.
    expect(src).not.toContain('proposalNothingToApply')
  })

  /**
   * The CARD's hidden block asks the SAME builder a narrower question — "what does THIS machine
   * hide, and where else is that restriction applied?" — instead of carrying a second
   * implementation. Two surfaces disagreeing about what is hidden would be worse than either.
   */
  it('scope "selfRestricted" keeps only the rows this machine hides, and nothing else changes', () => {
    const input = {
      self: { shareMode: 'denylist' as const, sources: [{ type: 'repo' as const, value: 'github.com/acme/api' }] },
      selfLabel: 'This machine',
      siblings: [
        sibling({ machineId: 'm1', machineName: 'Alienware', sources: [{ type: 'repo', value: 'github.com/acme/api' }] }),
        sibling({ machineId: 'm2', machineName: 'Laptop B', sources: [{ type: 'repo', value: 'github.com/acme/secret' }] }),
      ],
    }
    // Unscoped (the notices modal): every bucket ANYBODY withholds.
    expect(buildRestrictionTable(input).rows.map(r => r.value).sort())
      .toEqual(['github.com/acme/api', 'github.com/acme/secret'])
    // Scoped (the card): only what this machine hides from this central — a sibling's own
    // restriction is not something this card may claim to be hiding.
    const scoped = buildRestrictionTable({ ...input, scope: 'selfRestricted' })
    expect(scoped.rows.map(r => r.value)).toEqual(['github.com/acme/api'])
    // The kept row is the SAME row, sibling column and all — narrowed, never rebuilt.
    expect(scoped.rows[0]!.restrictedBy.map(m => m.machineName)).toEqual(['This machine', 'Alienware'])
    expect(scoped.rows[0]!.selfRestricts).toBe(true)
  })

  it('scope "selfRestricted" still answers when no sibling has announced anything', () => {
    const scoped = buildRestrictionTable({
      self: { shareMode: 'denylist', sources: [{ type: 'project', value: '/home/me/api' }, { type: 'none', value: '' }] },
      selfLabel: 'This machine',
      siblings: [],
      scope: 'selfRestricted',
    })
    expect(scoped.rows.map(r => r.kind).sort()).toEqual(['none', 'project'])
    // Every row names this machine and no other — the block above the table says so in words.
    for (const row of scoped.rows) {
      expect(row.restrictedBy.map(m => m.self)).toEqual([true])
    }
    expect(scoped.rows).toHaveLength(2)
  })

  it('is total — junk sources and an empty account produce an empty table, never a throw', () => {
    const table = buildRestrictionTable({
      self: { shareMode: 'denylist', sources: [{ type: 'repo', value: '' }, { type: 'project', value: '' }] },
      selfLabel: 'This machine',
      siblings: [],
    })
    expect(table.rows).toEqual([])
    expect(table.allowlistMachines).toEqual([])
  })
})
