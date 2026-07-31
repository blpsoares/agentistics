/**
 * notifications-authority.ts — PURE: is a notification's SUBJECT visible to a principal?
 *
 * On a central, "everything reaches every authenticated account" was the whole rule until now: a
 * plain user could see notifications about machines that were not theirs and teams they did not
 * belong to. This module gives a notification a SUBJECT — what it is about — and answers, from the
 * principal's role and memberships alone, whether that subject is theirs to know about:
 *
 *  - owner        → everything.
 *  - manager      → subjects belonging to the teams they manage (those teams' machines, those
 *                    teams' members, and — through plain membership — the teams themselves).
 *  - plain user   → their own machines, and the teams they belong to.
 *
 * REUSE, NOT A SECOND ANSWER. Each subject kind is checked with the exact same authority that
 * already gates the corresponding surface, so "may this principal see a notification about X" can
 * never quietly drift from "may this principal manage X":
 *  - `team`    → `teamVisibleTo`    (iam-view.ts)  — the same check that scopes the team list.
 *  - `machine` → `canManageMachine` (iam-view.ts)  — the same check the machine-admin routes use.
 *  - `account` → `accountVisibleTo` (iam-view.ts)  — the same check the accounts panel uses.
 *  - `tag`     → the caller pre-resolves readability into `readableTagIds` via
 *                `tags-authority.ts`'s own `canReadTag`, so this module never has to know a tag's
 *                shape (sources/sharedWith/createdBy )— it only asks "is this id in the set".
 *
 * NO SUBJECT = INSTANCE-WIDE. A notification about the instance itself (an update banner, a
 * central-level notice with no single owner) carries no subject at all, and reaches every
 * authenticated account, owner or not — withholding it from everyone but the owner would silence a
 * message every account genuinely needs, for a device that happens to have no one specific target.
 *
 * FAIL CLOSED. A subject this module cannot resolve — an id absent from the context the caller
 * built, or a kind it does not recognise — is denied to anyone but the owner. A missed
 * notification is an annoyance; a leaked one is the bug this module exists to prevent.
 */
import type { AccountDoc, Membership, Principal } from './iam-types'
import { teamVisibleTo, canManageMachine, accountVisibleTo } from './iam-view'

export type NotificationSubjectKind = 'machine' | 'team' | 'account' | 'tag'

/** What a notification is about. Set by the emitter; absent means instance-wide. */
export interface NotificationSubject {
  kind: NotificationSubjectKind
  id: string
}

/** Structural subset of a machine record — exactly what `canManageMachine` needs, kept minimal so
 *  this module (and its tests) depend on no Mongo type. */
export interface SubjectMachine {
  teamId?: string
  teamIds?: string[]
  accountId?: string
  accountIds?: string[]
}

/**
 * Everything the caller must resolve from the DB ONCE PER REQUEST before asking — never per
 * notification, and never re-derived here. Absence of an id from these maps is a legitimate,
 * expected state (a machine or account that no longer exists) and resolves to "denied", not to an
 * error.
 */
export interface NotificationAuthorityContext {
  /** machineId (memberId / token hash) → its team(s) and owner-account(s). */
  machines: Record<string, SubjectMachine>
  /** accountId → that account's memberships, for `accountVisibleTo` (which needs the TARGET's
   *  memberships, not the caller's). */
  accountMemberships: Record<string, Membership[]>
  /** Tag ids the principal may already read, resolved by the caller via `tags-authority.ts`'s
   *  `canReadTag` — this module makes no independent decision about tags. */
  readableTagIds: Set<string>
}

/** Pure: may `p` receive a notification about `subject`? `subject` absent = instance-wide. */
export function subjectVisibleTo(
  p: Principal,
  subject: NotificationSubject | undefined,
  ctx: NotificationAuthorityContext,
): boolean {
  if (p.role === 'owner') return true
  if (!subject) return true
  switch (subject.kind) {
    case 'team':
      return teamVisibleTo(p, subject.id)
    case 'machine': {
      const machine = ctx.machines[subject.id]
      if (!machine) return false // unresolved subject — fail closed
      return canManageMachine(p, machine)
    }
    case 'account': {
      if (subject.id === p.accountId) return true
      const memberships = ctx.accountMemberships[subject.id]
      if (!memberships) return false // unresolved subject — fail closed
      return accountVisibleTo(p, { _id: subject.id, memberships } as AccountDoc)
    }
    case 'tag':
      return ctx.readableTagIds.has(subject.id)
    default:
      return false // unrecognized kind — fail closed
  }
}
