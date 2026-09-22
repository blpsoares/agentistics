/**
 * subtaskGroups.ts — pure reads over a delivery's own subtask list for the group-forming gestures
 * (§F.1 of docs/superpowers/specs/2026-09-11-alm-session-linking-ux.md): a "grupo de subtasks" is a
 * real hierarchy level, not a label two subtasks share.
 *
 * `isGroupSubtask`/`isGroupMember`/`groupMembers` mirror the server's own readings
 * (`task-model.ts`) exactly — kept as a separate copy rather than imported, since `packages/web`
 * cannot import server modules (they pull in Node/Bun-only APIs `@agentistics/core`'s import
 * boundary exists to keep out of the browser bundle). Every function here is total and holds no
 * network call: the SERVER is still the only place a group write can actually be refused
 * (`checkParentGroup`, `task-attach.ts`) — the candidate lists below only decide what a PICKER
 * OFFERS, so the common case does not have to hit a refusal it could have avoided by construction.
 */

import type { CSSProperties } from 'react'
import type { Subtask } from '../../lib/tasks'

/** Is this subtask a GROUP (§F.1)? Mirrors the server's `isGroupSubtask` (`task-model.ts`). */
export function isGroupSubtask(s: Pick<Subtask, 'isGroup'>): boolean {
  return s.isGroup === true
}

/** Is this subtask a MEMBER of a group (§F.1)? Mirrors the server's `isGroupMember`. */
export function isGroupMember(s: Pick<Subtask, 'parentGroupId'>): boolean {
  return Boolean(s.parentGroupId)
}

/** Every member of a group, in the order they were created. Mirrors the server's `groupMembers`. */
export function groupMembers(groupId: string, subtasks: readonly Subtask[]): Subtask[] {
  return subtasks.filter(s => s.parentGroupId === groupId)
}

/** The group a MEMBER belongs to, or `undefined` when the reference is stale (a group deleted out
 *  from under it — the same "unknown" answer `subtaskRollupOf` gives for a bucket the server no
 *  longer reports). Used to render "part of group: <title>" without a second fetch. */
export function groupOf(
  subtask: Pick<Subtask, 'parentGroupId'>,
  subtasks: readonly Subtask[],
): Subtask | undefined {
  if (!subtask.parentGroupId) return undefined
  return subtasks.find(s => s.id === subtask.parentGroupId)
}

/**
 * Candidates for "Criar grupo com…", offered from `subtaskId`'s own row: every OTHER subtask of the
 * same delivery that is neither a group nor already a member of one — the row itself is excluded
 * too, since a subtask cannot form a group with itself. `subtasks` is assumed already scoped to one
 * delivery (the same assumption every caller of this module already makes — `SubtaskTable`'s own
 * `p.subtasks`, `TaskDetail.subtasks`), so no `taskId` filter is repeated here; the server still
 * enforces the same-task rule independently (`checkParentGroup`).
 */
export function createGroupCandidates(
  subtaskId: string,
  subtasks: readonly Subtask[],
): Subtask[] {
  return subtasks.filter(s => s.id !== subtaskId && !isGroupSubtask(s) && !isGroupMember(s))
}

/**
 * Candidates for "Entrar em grupo existente…" — every GROUP of the same delivery. A group can never
 * itself be a member (`checkParentGroup` refuses `isGroup: true` outright), so the initiating row's
 * own id needs no exclusion here the way `createGroupCandidates` excludes it.
 */
export function joinGroupCandidates(subtasks: readonly Subtask[]): Subtask[] {
  return subtasks.filter(isGroupSubtask)
}

/**
 * One row of a subtask list laid out for CLUSTERED rendering — a group and its members read as one
 * visually connected unit (product feedback, 2026-09-19: "quando existirem subtasks agrupadas, a
 * visualizacao delas tambem deve ser agrupada e nao mostrar um icone de grupo"). A subtask's own
 * array position is CREATION order, which is not display order once a group forms after its members
 * already exist (the common case: you group two existing subtasks together) — so this walks the
 * list once and pulls every member to sit directly under its group, wherever the group itself sits,
 * rather than leaving the reader to reconstruct the relationship from a caption on each member row.
 */
export interface SubtaskClusterRow {
  subtask: Subtask
  /** 0 for a loose subtask or a group header; 1 for a row rendered as a member under its group. */
  depth: 0 | 1
  /** This row belongs to a REAL cluster (a group with at least one member) — the header and every
   *  member both carry this, so the caller draws the connecting bar/tint on exactly this set. False
   *  for a loose subtask, an EMPTY group (no bar to draw down to), and an ORPHANED member (its
   *  `parentGroupId` names no subtask in this list — never dropped, just rendered as a loose row,
   *  the same "unknown" fallback `groupOf` already gives it). */
  clustered: boolean
  /** The row that OPENS the cluster's bar — a non-empty group's own header row. */
  clusterFirst: boolean
  /** The row that CLOSES the cluster's bar — a group's last member. */
  clusterLast: boolean
}

export function clusterSubtaskRows(subtasks: readonly Subtask[]): SubtaskClusterRow[] {
  const rows: SubtaskClusterRow[] = []
  for (const s of subtasks) {
    if (isGroupMember(s)) {
      // Placed under its group below, wherever that group falls in the loop — UNLESS the group it
      // names is gone from this list, in which case there is no header to place it under and it
      // renders here instead, exactly like a loose row (never silently dropped).
      if (subtasks.some(g => g.id === s.parentGroupId)) continue
      rows.push({ subtask: s, depth: 0, clustered: false, clusterFirst: false, clusterLast: false })
      continue
    }
    if (isGroupSubtask(s)) {
      const members = groupMembers(s.id, subtasks)
      const hasMembers = members.length > 0
      rows.push({ subtask: s, depth: 0, clustered: hasMembers, clusterFirst: hasMembers, clusterLast: false })
      members.forEach((m, i) => {
        rows.push({
          subtask: m, depth: 1, clustered: true, clusterFirst: false, clusterLast: i === members.length - 1,
        })
      })
      continue
    }
    rows.push({ subtask: s, depth: 0, clustered: false, clusterFirst: false, clusterLast: false })
  }
  return rows
}

/** The one accent colour every cluster's connecting bar and tint uses — a single, neutral token
 *  (never the orange this board already spends on status/cost/"ready") so a group's rows read as a
 *  STRUCTURAL unit, not as another status colour to learn. */
export const CLUSTER_ACCENT = 'var(--text-tertiary)'
export const CLUSTER_TINT = 'var(--bg-elevated)'

/** The inset left bar — drawn INSIDE the cell so it never widens a column or fights
 *  `border-collapse`, and lines up into one continuous stripe across adjacent clustered rows since
 *  consecutive `<tr>`s sit with no gap between them. Applied to a cluster row's leading cell only. */
export const clusterBarStyle = (clustered: boolean): CSSProperties =>
  (clustered ? { boxShadow: `inset 3px 0 0 0 ${CLUSTER_ACCENT}` } : {})

/** The shared tint for every cell of a clustered row (header + members alike) — what makes the
 *  group read as one container instead of a caption repeated on each member. */
export const clusterTintStyle = (clustered: boolean): CSSProperties =>
  (clustered ? { background: CLUSTER_TINT } : {})

/**
 * Which of `clusterSubtaskRows`' own rows are actually DRAWN, given which groups the reader has
 * chosen to open — product feedback, 2026-09-21: with 30+ done subtasks spread across several
 * groups, every member always visible turned the list into a wall of struck-through rows nobody
 * could scan. A group therefore reads as an ACCORDION, collapsed by default (the caller's `Set` of
 * expanded ids starts empty), the same interaction this board already uses one level up for a
 * task's own subtask expansion (`TaskTable`'s `expanded` state + chevron).
 *
 * Expand/collapse is UI STATE, never something this pure layout function owns — it is handed in as
 * a set so the same clustered rows can be filtered without recomputing the cluster or touching
 * `p.subtasks`. Only a genuinely CLUSTERED member (`depth === 1`, which `clusterSubtaskRows` only
 * ever assigns to a member sitting under a non-empty group) is foldable; a header, a loose subtask
 * and an ORPHANED member (no cluster to fold into) are always `depth === 0` and always show — the
 * same rows `clustered` already marks as having nothing to draw a bar down to.
 */
export function visibleClusterRows(
  rows: readonly SubtaskClusterRow[],
  expandedGroupIds: ReadonlySet<string>,
): SubtaskClusterRow[] {
  return rows.filter(r => (
    r.depth === 0 || (r.subtask.parentGroupId !== undefined && expandedGroupIds.has(r.subtask.parentGroupId))
  ))
}
