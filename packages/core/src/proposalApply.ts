/**
 * proposalApply.ts — PURE. What "Apply here" is allowed to do to THIS machine's sharing rules.
 *
 * THE RULE: applying a sibling's proposal may only ever NARROW what this machine shares. A button
 * whose whole purpose is to hide things must never, on any path, START sharing something the user
 * had already chosen to hide. Applying the sibling's snapshot VERBATIM does exactly that — it
 * replaces this machine's rule set, so every restriction the sibling does not happen to hold is
 * silently lifted. That was a real bug, found on real machines.
 *
 * So the merge is the INTERSECTION of the two rule sets: a bucket is shared afterwards only if it
 * was shared here AND is shared under the proposal. Written out by case:
 *
 *   current denylist  + proposal denylist   → denylist, the UNION of both denials
 *   current allowlist + proposal denylist   → allowlist, current's list MINUS what the proposal denies
 *   current denylist  + proposal allowlist  → allowlist, the proposal's list MINUS what this machine denies
 *   current allowlist + proposal allowlist  → allowlist, the INTERSECTION of both lists
 *
 * Each of those is the exact intersection, not an approximation of it — so the merge loses nothing
 * the proposal asks for and gives up nothing the user already had.
 *
 * WHAT A SOURCE DOES AND DOES NOT SAY ABOUT SESSIONS. A source names a bucket on ONE dimension
 * (`project:/p` is every session in `/p`, whatever repository each belongs to) while `sessionShared`
 * decides on BOTH, so rule-set membership is not the same question as "is this bucket shared".
 * `stopsSharing` is therefore held to the joint reading — it names a row only when nothing of it
 * ships afterwards and something did before — and rows the rules alone cannot settle are demoted to
 * `partlyRestricts`, which the UI may only ever render as "no longer listed". Deciding this by
 * membership once named a project that kept shipping through its repository: a false sentence, in
 * the reassuring direction, at the moment of the decision.
 *
 * `sessionShared`'s ambiguous-directory clause (`PathRepoIndex.conflicts`) is deliberately not
 * modelled here: it only ever REMOVES sharing, in both modes, and this module's inputs are rules
 * rather than sessions. `share-rules.test.ts` exercises the merge THROUGH that clause so the
 * narrowing property is checked against it mechanically rather than argued.
 *
 * WHAT THE UI STILL HAS TO SAY. Narrowing-only is the default, never a silent rewrite of the
 * message: `wouldStartSharing` / `widensEverythingUnlisted` name precisely what applying the
 * proposal VERBATIM would have opened, so the difference between "what the sibling sent" and "what
 * this machine will do" is stated rather than assumed, and the user decides.
 *
 * PURITY: no I/O, no clock. `share-rules.ts` (server) remains the single source of the SHARING
 * semantics — this module only ever composes two rule sets and asks `shareSourceKey` for keys;
 * `share-rules.test.ts` cross-checks the outcome against `sessionShared` itself.
 */
import type { ShareSource } from './team'
import { shareSourceKey, type AnnouncedRules } from './siblingRules'

export interface MergedRules {
  shareMode: 'denylist' | 'allowlist'
  sources: ShareSource[]
}

export interface ProposalApplyPlan {
  /** The rules to actually PATCH — narrowing-only. */
  merged: MergedRules
  /**
   * Sources shared under the current rules and NOT shared under `merged` — the rows this apply
   * newly hides on THIS machine. Evaluated per NAMED source (one dimension at a time); buckets
   * neither rule set names are covered by the two booleans below instead.
   */
  stopsSharing: ShareSource[]
  /**
   * Sources the merge newly restricts whose OUTCOME the rules alone cannot settle — the row stops
   * being listed, but sessions in it may still be shared through the other dimension (a project
   * dropped from an allowlist whose repository is still allowed). Kept apart from `stopsSharing`
   * because they carry different sentences: this one may only ever be rendered as "no longer
   * listed", never as "stops being shared".
   */
  partlyRestricts: ShareSource[]
  /**
   * Sources this machine currently hides that applying the proposal VERBATIM would start sharing.
   * Non-empty means the sibling's snapshot is more permissive here than the user's own rules — the
   * merge refuses to do it, and the UI must say so.
   */
  wouldStartSharing: ShareSource[]
  /** Verbatim would also open every bucket NEITHER side names (an allowlist here, a denylist
   *  there). Not expressible as a source list, so it is its own flag. */
  widensEverythingUnlisted: boolean
  /** `merged` is an allowlist where the current rules were a denylist: everything the merged list
   *  does not name stops being shared. Narrowing, and large — worth stating. */
  hidesEverythingUnlisted: boolean
  /** `merged` is rule-for-rule what this machine already has: there is nothing to decide. */
  changesNothing: boolean
}

function keySet(sources: readonly ShareSource[] | undefined): Set<string> {
  const out = new Set<string>()
  for (const s of sources ?? []) {
    const key = shareSourceKey(s)
    if (key) out.add(key)
  }
  return out
}

/** The sources of `list` whose key passes `keep`, deduplicated by key, order preserved. */
function pick(list: readonly ShareSource[] | undefined, keep: (key: string) => boolean): ShareSource[] {
  const seen = new Set<string>()
  const out: ShareSource[] = []
  for (const s of list ?? []) {
    const key = shareSourceKey(s)
    if (!key || seen.has(key) || !keep(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

/**
 * A source names a bucket on ONE dimension only — `project:/p` is every session in `/p`, whatever
 * repository each belongs to — and `sessionShared` decides on BOTH. So membership in the rule set
 * is not the same question as "is this bucket shared", and the two predicates below are the honest
 * ones. `hasOtherDimension` is what makes them so: a rule set naming the other dimension can share
 * (allowlist) or deny (denylist) part of a bucket without naming it.
 *
 * Both are deliberately CERTAIN, never probable — they answer only when the rules settle it for
 * every session of the bucket, and stay silent otherwise.
 */
function isProjectKey(key: string): boolean {
  return key.startsWith('project:')
}

function hasOtherDimension(keys: ReadonlySet<string>, key: string): boolean {
  const project = isProjectKey(key)
  for (const k of keys) if (isProjectKey(k) !== project) return true
  return false
}

/** Membership only: whether the rule set LISTS this bucket as shared on its own dimension. Never a
 *  claim about the sessions in it — that is what the two predicates below are for. */
function listedAsShared(mode: 'denylist' | 'allowlist', keys: ReadonlySet<string>, key: string): boolean {
  return mode === 'allowlist' ? keys.has(key) : !keys.has(key)
}

/** Every session of this bucket is shared — the rules cannot be hiding part of it elsewhere. */
function definitelyShared(mode: 'denylist' | 'allowlist', keys: ReadonlySet<string>, key: string): boolean {
  if (mode === 'allowlist') return keys.has(key)
  // denylist: named → wholly denied; unnamed → shared unless the OTHER dimension denies part of it.
  return !keys.has(key) && !hasOtherDimension(keys, key)
}

/** NO session of this bucket is shared. */
function definitelyHidden(mode: 'denylist' | 'allowlist', keys: ReadonlySet<string>, key: string): boolean {
  if (mode === 'denylist') return keys.has(key)
  // allowlist: unnamed → hidden, unless the OTHER dimension allows part of it back in.
  return !keys.has(key) && !hasOtherDimension(keys, key)
}

function modeOf(rules: AnnouncedRules): 'denylist' | 'allowlist' {
  return rules.shareMode === 'allowlist' ? 'allowlist' : 'denylist'
}

/**
 * The plan for applying `proposal` on a machine whose rules are `current`. Total: junk sources are
 * dropped exactly as every other reader drops them, and no input can produce rules more permissive
 * than `current`.
 */
export function planProposalApply(current: AnnouncedRules, proposal: AnnouncedRules): ProposalApplyPlan {
  const curMode = modeOf(current)
  const propMode = modeOf(proposal)
  const curKeys = keySet(current.sources)
  const propKeys = keySet(proposal.sources)

  let merged: MergedRules
  if (curMode === 'denylist' && propMode === 'denylist') {
    // Union: everything either machine hides stays hidden.
    merged = {
      shareMode: 'denylist',
      sources: [...pick(current.sources, () => true), ...pick(proposal.sources, k => !curKeys.has(k))],
    }
  } else if (curMode === 'allowlist' && propMode === 'denylist') {
    merged = { shareMode: 'allowlist', sources: pick(current.sources, k => !propKeys.has(k)) }
  } else if (curMode === 'denylist' && propMode === 'allowlist') {
    // The one case whose exact intersection is NOT expressible as a single rule set: "share only P,
    // except D" needs both a list and a denial. A session belongs to a repo bucket AND a project
    // bucket, and denial wins across dimensions (`sessionShared`), so allowing a proposal source
    // whose sessions could ALSO sit in a bucket this machine denies would re-open it — the exact
    // failure `share-rules.test.ts`'s cross-check catches. So the merge keeps only the sources that
    // provably cannot overlap a local denial, which is narrower than the intersection and never
    // wider:
    //   a `repo` / `none` source can only be re-opened by a denied PROJECT (a session has one repo)
    //   a `project` source can be re-opened by a denied repo OR by the unattributed bucket
    const deniesProject = [...curKeys].some(k => k.startsWith('project:'))
    const deniesRepoBucket = [...curKeys].some(k => k.startsWith('repo:') || k === 'none:')
    merged = {
      shareMode: 'allowlist',
      sources: pick(proposal.sources, k => {
        if (curKeys.has(k)) return false
        if (k.startsWith('project:')) return !deniesRepoBucket
        return !deniesProject
      }),
    }
  } else {
    merged = { shareMode: 'allowlist', sources: pick(current.sources, k => propKeys.has(k)) }
  }

  const mergedKeys = keySet(merged.sources)
  const stopsSharing: ShareSource[] = []
  const partlyRestricts: ShareSource[] = []
  const wouldStartSharing: ShareSource[] = []
  const seen = new Set<string>()
  for (const s of [...(current.sources ?? []), ...(proposal.sources ?? [])]) {
    const key = shareSourceKey(s)
    if (!key || seen.has(key)) continue
    seen.add(key)
    // "Applying stops sharing X" is only true when NOTHING of X ships afterwards and something did
    // before. Deciding it by membership alone named a project that keeps shipping through its
    // repository — a false sentence, in the reassuring direction, at the moment of the decision.
    if (definitelyShared(curMode, curKeys, key) && definitelyHidden(merged.shareMode, mergedKeys, key)) {
      stopsSharing.push(s)
    } else if (listedAsShared(curMode, curKeys, key) && !listedAsShared(merged.shareMode, mergedKeys, key)) {
      // The merge does restrict this row — it just cannot promise the row goes dark, because the
      // other dimension may still carry some of it. Said in weaker words rather than dropped: the
      // user is choosing, and "nothing here changes" would be its own false statement.
      partlyRestricts.push(s)
    }
    // The warning is the mirror, and its uncertainty falls the other way ON PURPOSE: it fires when
    // this machine certainly hides the bucket and applying verbatim would share ANY of it. A
    // warning shown for a case that might not arise costs a sentence; one withheld costs the user
    // the only notice that the sibling's snapshot is more permissive than their own rules.
    if (definitelyHidden(curMode, curKeys, key) && !definitelyHidden(propMode, propKeys, key)) {
      wouldStartSharing.push(s)
    }
  }

  const changesNothing = merged.shareMode === curMode
    && mergedKeys.size === curKeys.size
    && [...mergedKeys].every(k => curKeys.has(k))

  return {
    merged,
    stopsSharing,
    partlyRestricts,
    wouldStartSharing,
    widensEverythingUnlisted: curMode === 'allowlist' && propMode === 'denylist',
    hidesEverythingUnlisted: curMode === 'denylist' && merged.shareMode === 'allowlist',
    changesNothing,
  }
}

/**
 * BUG 2's predicate, stated once. An announcement that would add NOTHING to the recipient's current
 * rules is not a proposal — there is no decision in it — and turning it into a card is what made
 * applying a proposal bounce one back forever: A applies B's rules, A's rules change, A announces,
 * B is offered its own rules back, and round it goes.
 *
 * This suppresses the OFFER only. The sibling's announced rules are still stored as a FACT
 * (`siblingRules`), because "that machine withholds this" stays true whether or not there is
 * anything here to apply.
 */
export function proposalAddsNothing(current: AnnouncedRules, proposal: AnnouncedRules): boolean {
  return planProposalApply(current, proposal).changesNothing
}
