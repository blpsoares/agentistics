/**
 * restrictionTable.ts — PURE. The one question the notices modal exists to answer:
 * **which repositories and projects are NOT shared with this central, and on which machines.**
 *
 * It replaced a card per proposal, each restating the same three sentences about one sibling's
 * whole rule set. That reading answers "what did Alienware send?", which is not the question a
 * person opening this screen has; two announcements from one machine produced two nearly identical
 * walls of prose, and a restriction applied on three machines was three separate paragraphs the
 * reader had to intersect by hand. Rows are the RESTRICTED BUCKETS and the cells name the machines,
 * so the same facts collapse into something scannable.
 *
 * WHAT IT IS BUILT FROM, AND WHY IT IS NOT THE PROPOSAL LIST. The rows come from the standing FACTS
 * (`siblingRules` — what each machine last announced about its OWN rules) plus this machine's live
 * rules. A dismissed proposal must not erase a row: "that machine withholds this" stays true
 * whether or not there is an offer attached to it (`envelope-inbox.ts`).
 *
 * WHAT IT CANNOT SAY, AND SAYS IN WORDS INSTEAD. A machine in ALLOWLIST mode withholds everything
 * it does not name, which is not a set of rows — no table can enumerate the buckets nobody
 * mentioned. Those machines are returned separately (`allowlistMachines`) so the UI can state it.
 * And the whole surface is best-effort in the same way the rules picker's badge is: this machine
 * knows only what its siblings announced to it, and only since the encrypted channel existed.
 *
 * PURITY AND REUSE. `bucketSharedBy` / `siblingsWithholding` (`@agentistics/core`) decide sharing —
 * `share-rules.ts` remains the single source of those semantics — and `planProposalApply` decides
 * whether acting on a row would change anything. Nothing here re-derives either.
 */
import {
  NO_REPO_KEY, bucketSharedBy, siblingsWithholding, planProposalApply, projectNameKey,
  shareSourceKey, type ShareSource, type SiblingRuleFact, type AnnouncedRules, type ShareBucket,
} from '@agentistics/core'

export interface RestrictionMachine {
  /** `''` for this machine. */
  machineId: string
  machineName: string
  self: boolean
  /**
   * The sibling's OWN project paths that correlate with this row by folder name. Empty for a repo
   * row (no guess was involved) and for a withholding by omission (an allowlist that simply never
   * names the project has no path to offer). Never invented.
   */
  paths: string[]
}

export interface RestrictionRow {
  /** Canonical `${type}:${value}` key — stable across renders, so it is also the React key. */
  key: string
  kind: 'repo' | 'project' | 'none'
  /** The value to DISPLAY: a canonical repo key, a project path, or `NO_REPO_KEY`. */
  value: string
  /**
   * The source to restrict on THIS machine, or `null` when this machine cannot express the row.
   * A repository key is machine-independent; a project path is not, so a project row is actionable
   * only when exactly one local project carries that folder name — a rule must name the exact path
   * it denies, and guessing between two candidates would deny a path the user never chose.
   */
  source: ShareSource | null
  restrictedBy: RestrictionMachine[]
  sharedBy: RestrictionMachine[]
  selfRestricts: boolean
  /** Acting on this row here is possible AND would change something. */
  applicable: boolean
}

export interface RestrictionTable {
  rows: RestrictionRow[]
  /** Machines (this one included) that share only what they list — they also withhold everything
   *  no row can name. */
  allowlistMachines: RestrictionMachine[]
}

export interface RestrictionTableInput {
  /** This machine's live rules for this connection. */
  self: AnnouncedRules
  /** Already-localized name for this machine's own column entries. */
  selfLabel: string
  siblings: readonly SiblingRuleFact[]
  /** This machine's known project paths — what makes a project row actionable here. */
  localProjects?: readonly string[]
}

const SELF_ID = ''

function selfMachine(label: string): RestrictionMachine {
  return { machineId: SELF_ID, machineName: label, self: true, paths: [] }
}

/** The bucket a source names, on its own dimension. */
function bucketOf(source: ShareSource): ShareBucket {
  if (source.type === 'project') return { projectPath: source.value }
  if (source.type === 'none') return { repoKey: NO_REPO_KEY }
  return { repoKey: source.value }
}

function kindOf(source: ShareSource): 'repo' | 'project' | 'none' {
  return source.type === 'project' ? 'project' : source.type === 'none' ? 'none' : 'repo'
}

/**
 * The local source that expresses this row, or `null`.
 *
 * The project dimension is the whole reason this exists: the sibling announced ITS path, and a rule
 * written here must name THIS machine's path or it denies nothing. Folder-name correlation is a
 * heuristic (`api`, `web`, `docs` collide), so it resolves only when it is unambiguous — one local
 * project with that name — and stays silent otherwise rather than picking one.
 */
function localSourceFor(
  source: ShareSource,
  ownedHere: boolean,
  localProjects: readonly string[],
): ShareSource | null {
  if (source.type !== 'project') return source
  if (ownedHere) return source
  const name = projectNameKey(source.value)
  if (!name) return null
  const matches = localProjects.filter(p => projectNameKey(p) === name)
  return matches.length === 1 ? { type: 'project', value: matches[0]! } : null
}

export function buildRestrictionTable(input: RestrictionTableInput): RestrictionTable {
  const { self, selfLabel, siblings, localProjects = [] } = input

  // The row universe: every bucket ANYBODY named. A bucket nobody named cannot be a row — see the
  // allowlist note in the module docstring.
  const origins = new Map<string, { source: ShareSource; ownedHere: boolean }>()
  const collect = (sources: readonly ShareSource[] | undefined, ownedHere: boolean) => {
    for (const s of sources ?? []) {
      const key = shareSourceKey(s)
      if (!key) continue
      const prev = origins.get(key)
      // This machine's own spelling of a bucket wins: it is the one a local rule can name.
      if (!prev || (ownedHere && !prev.ownedHere)) origins.set(key, { source: s, ownedHere })
    }
  }
  collect(self.sources, true)
  for (const f of siblings) collect(f.sources, false)

  const me = selfMachine(selfLabel)
  const rows: RestrictionRow[] = []
  for (const [key, { source, ownedHere }] of origins) {
    const bucket = bucketOf(source)
    const selfRestricts = !bucketSharedBy(bucket, self)
    const withholding = siblingsWithholding(siblings, bucket)
    if (!selfRestricts && withholding.length === 0) continue

    const withheldIds = new Set(withholding.map(w => w.machineId))
    const restrictedBy: RestrictionMachine[] = [
      ...(selfRestricts ? [me] : []),
      ...withholding.map(w => ({ machineId: w.machineId, machineName: w.machineName, self: false, paths: w.paths })),
    ]
    const sharedBy: RestrictionMachine[] = [
      ...(selfRestricts ? [] : [me]),
      ...siblings
        .filter(f => !withheldIds.has(f.machineId))
        .map(f => ({ machineId: f.machineId, machineName: f.machineName, self: false, paths: [] })),
    ]
    const local = localSourceFor(source, ownedHere, localProjects)
    // "Would applying just this row change anything here?" — the same narrowing-only arithmetic the
    // Apply button itself runs, asked of a one-source denial.
    const applicable = local !== null
      && !planProposalApply(self, { shareMode: 'denylist', sources: [local] }).changesNothing
    rows.push({
      key,
      kind: kindOf(source),
      value: source.type === 'none' ? NO_REPO_KEY : (local?.value ?? source.value),
      source: local,
      restrictedBy,
      sharedBy,
      selfRestricts,
      applicable,
    })
  }

  // Actionable rows first — they are the only ones holding a decision — then by name, so a poll
  // never reorders the table under the user's cursor.
  rows.sort((a, b) => Number(b.applicable) - Number(a.applicable) || a.value.localeCompare(b.value))

  const allowlistMachines: RestrictionMachine[] = [
    ...(self.shareMode === 'allowlist' ? [me] : []),
    ...siblings
      .filter(f => f.shareMode === 'allowlist')
      .map(f => ({ machineId: f.machineId, machineName: f.machineName, self: false, paths: [] })),
  ]

  return { rows, allowlistMachines }
}
