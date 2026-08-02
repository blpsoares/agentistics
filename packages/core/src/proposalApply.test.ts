import { describe, it, expect } from 'bun:test'
import { NO_REPO_KEY } from './team'
import type { ShareSource } from './team'
import { planProposalApply, proposalAddsNothing } from './proposalApply'
import { bucketSharedBy } from './siblingRules'

const repo = (v: string): ShareSource => ({ type: 'repo', value: v })
const proj = (v: string): ShareSource => ({ type: 'project', value: v })
const none: ShareSource = { type: 'none', value: '' }

/** Every bucket named anywhere in this file, so a property can be checked over all of them. */
const BUCKETS = [
  { repoKey: 'github.com/acme/api' },
  { repoKey: 'github.com/acme/web' },
  { repoKey: 'github.com/acme/secret' },
  { repoKey: NO_REPO_KEY },
  { projectPath: '/home/me/api' },
  { projectPath: '/home/me/secret' },
]

describe('applying a proposal never removes an existing restriction', () => {
  const CASES: { name: string; current: Parameters<typeof planProposalApply>[0]; proposal: Parameters<typeof planProposalApply>[1] }[] = [
    {
      name: 'denylist here, denylist there',
      current: { shareMode: 'denylist', sources: [repo('github.com/acme/secret'), proj('/home/me/secret')] },
      proposal: { shareMode: 'denylist', sources: [repo('github.com/acme/api')] },
    },
    {
      name: 'allowlist here, denylist there',
      current: { shareMode: 'allowlist', sources: [repo('github.com/acme/api'), repo('github.com/acme/web')] },
      proposal: { shareMode: 'denylist', sources: [repo('github.com/acme/web')] },
    },
    {
      name: 'denylist here, allowlist there',
      current: { shareMode: 'denylist', sources: [repo('github.com/acme/secret'), none] },
      proposal: { shareMode: 'allowlist', sources: [repo('github.com/acme/api'), repo('github.com/acme/secret'), none] },
    },
    {
      name: 'allowlist here, allowlist there',
      current: { shareMode: 'allowlist', sources: [repo('github.com/acme/api')] },
      proposal: { shareMode: 'allowlist', sources: [repo('github.com/acme/api'), repo('github.com/acme/web')] },
    },
    {
      name: 'the sibling restricts nothing at all — the widest possible proposal',
      current: { shareMode: 'denylist', sources: [repo('github.com/acme/secret'), proj('/home/me/secret'), none] },
      proposal: { shareMode: 'denylist', sources: [] },
    },
  ]

  for (const c of CASES) {
    it(`${c.name}: no bucket hidden here becomes shared`, () => {
      const plan = planProposalApply(c.current, c.proposal)
      // The property, stated over EVERY bucket either side names: what was hidden stays hidden.
      let checked = 0
      for (const bucket of BUCKETS) {
        checked++
        const before = bucketSharedBy(bucket, c.current)
        const after = bucketSharedBy(bucket, plan.merged)
        if (!before) expect(after).toBe(false)
      }
      expect(checked).toBe(BUCKETS.length)
    })
  }

  it('is the exact bug the owner hit: applying a sibling that hides LESS keeps my own denials', () => {
    // Machine A hides `secret` and the unattributed bucket. Machine B hides only `api` and sends
    // that snapshot. Applying it verbatim (the old behaviour) would have un-hidden both of A's.
    const current = { shareMode: 'denylist' as const, sources: [repo('github.com/acme/secret'), none] }
    const proposal = { shareMode: 'denylist' as const, sources: [repo('github.com/acme/api')] }
    const { merged } = planProposalApply(current, proposal)
    expect(merged.shareMode).toBe('denylist')
    expect(merged.sources.map(s => `${s.type}:${s.value}`).sort()).toEqual([
      'none:', 'repo:github.com/acme/api', 'repo:github.com/acme/secret',
    ].sort())
    expect(bucketSharedBy({ repoKey: 'github.com/acme/secret' }, merged)).toBe(false)
    expect(bucketSharedBy({ repoKey: NO_REPO_KEY }, merged)).toBe(false)
    expect(bucketSharedBy({ repoKey: 'github.com/acme/api' }, merged)).toBe(false)
  })
})

describe('the cross-mode cases', () => {
  it('allowlist here + denylist there: the allowlist loses what the proposal denies, and NOTHING is opened', () => {
    const plan = planProposalApply(
      { shareMode: 'allowlist', sources: [repo('github.com/acme/api'), repo('github.com/acme/web')] },
      { shareMode: 'denylist', sources: [repo('github.com/acme/web')] },
    )
    expect(plan.merged.shareMode).toBe('allowlist')
    expect(plan.merged.sources.map(s => s.value)).toEqual(['github.com/acme/api'])
    // Verbatim would have turned "share only these two" into "share everything except web".
    expect(plan.widensEverythingUnlisted).toBe(true)
  })

  it('denylist here + allowlist there: the proposal list loses what this machine already denies', () => {
    const plan = planProposalApply(
      { shareMode: 'denylist', sources: [repo('github.com/acme/secret')] },
      { shareMode: 'allowlist', sources: [repo('github.com/acme/api'), repo('github.com/acme/secret')] },
    )
    expect(plan.merged.shareMode).toBe('allowlist')
    expect(plan.merged.sources.map(s => s.value)).toEqual(['github.com/acme/api'])
    // Verbatim would have started sharing `secret`, which this machine hides.
    expect(plan.wouldStartSharing.map(s => s.value)).toEqual(['github.com/acme/secret'])
    expect(plan.hidesEverythingUnlisted).toBe(true)
  })

  it('drops an allowed repo when this machine denies a PROJECT — denial wins across dimensions', () => {
    // A session of `api` could sit in the denied project, and an allowlist naming the repo would
    // share it again. The merge gives the source up rather than re-opening it.
    const plan = planProposalApply(
      { shareMode: 'denylist', sources: [proj('/home/me/secret')] },
      { shareMode: 'allowlist', sources: [repo('github.com/acme/api'), proj('/home/me/api')] },
    )
    expect(plan.merged.sources.map(s => `${s.type}:${s.value}`)).toEqual(['project:/home/me/api'])
  })

  it('drops an allowed project when this machine denies a repo or the unattributed bucket', () => {
    const plan = planProposalApply(
      { shareMode: 'denylist', sources: [none] },
      { shareMode: 'allowlist', sources: [proj('/home/me/api'), repo('github.com/acme/api')] },
    )
    expect(plan.merged.sources.map(s => `${s.type}:${s.value}`)).toEqual(['repo:github.com/acme/api'])
  })

  it('names what verbatim would open, and says nothing when verbatim is already safe', () => {
    const safe = planProposalApply(
      { shareMode: 'denylist', sources: [] },
      { shareMode: 'denylist', sources: [repo('github.com/acme/api')] },
    )
    expect(safe.wouldStartSharing).toEqual([])
    expect(safe.widensEverythingUnlisted).toBe(false)
  })
})

describe('stopsSharing — what the modal shows the user', () => {
  it('lists exactly the rows this apply newly hides', () => {
    const plan = planProposalApply(
      { shareMode: 'denylist', sources: [repo('github.com/acme/secret')] },
      { shareMode: 'denylist', sources: [repo('github.com/acme/api'), repo('github.com/acme/secret')] },
    )
    expect(plan.stopsSharing.map(s => s.value)).toEqual(['github.com/acme/api'])
  })

  it('is empty when the proposal asks for nothing this machine does not already do', () => {
    const plan = planProposalApply(
      { shareMode: 'denylist', sources: [repo('github.com/acme/api'), repo('github.com/acme/secret')] },
      { shareMode: 'denylist', sources: [repo('github.com/acme/api')] },
    )
    expect(plan.stopsSharing).toEqual([])
    expect(plan.changesNothing).toBe(true)
  })
})

describe('proposalAddsNothing — the ping-pong predicate', () => {
  it('is true for a proposal identical to the current rules (the message applying one sends back)', () => {
    const rules = { shareMode: 'denylist' as const, sources: [repo('github.com/acme/api'), none] }
    expect(proposalAddsNothing(rules, rules)).toBe(true)
  })

  it('is true when the sibling restricts a SUBSET of what this machine restricts', () => {
    expect(proposalAddsNothing(
      { shareMode: 'denylist', sources: [repo('github.com/acme/api'), repo('github.com/acme/web')] },
      { shareMode: 'denylist', sources: [repo('github.com/acme/api')] },
    )).toBe(true)
  })

  it('is false as soon as the sibling restricts something new — that IS a decision', () => {
    expect(proposalAddsNothing(
      { shareMode: 'denylist', sources: [repo('github.com/acme/api')] },
      { shareMode: 'denylist', sources: [repo('github.com/acme/web')] },
    )).toBe(false)
  })

  it('is false for a mode change, even with the same list — an empty allowlist hides everything', () => {
    expect(proposalAddsNothing(
      { shareMode: 'denylist', sources: [] },
      { shareMode: 'allowlist', sources: [] },
    )).toBe(false)
  })

  it('folds URL spellings, so the same repo announced over ssh is not a new restriction', () => {
    expect(proposalAddsNothing(
      { shareMode: 'denylist', sources: [repo('https://github.com/Acme/API.git')] },
      { shareMode: 'denylist', sources: [repo('git@github.com:acme/api')] },
    )).toBe(true)
  })
})
