/**
 * accountForm.ts — PURE: what the "create account" drawer refuses to send, and what it warns about.
 *
 * Extracted from `UsersSettings.tsx` so the rule can be tested without mounting a drawer.
 *
 * The membership half is NOT decided here — it is `canCreateAccountWith` from `@agentistics/core`,
 * the same predicate `iam-view.ts` gates the POST with. This file used to hold a second, stricter
 * copy ("at least one team, always"), which refused an owner something the server had never
 * refused: an account belonging to no team.
 */
import { canCreateAccountWith, isOwnerOnlyAccount, type IamScope, type IamMembership } from '@agentistics/core'

export type AccountDraftIssue = 'incomplete-fields' | 'team-required'

export interface AccountDraft {
  /** The signed-in principal creating the account. */
  scope: IamScope
  /** Which kind of account the form is producing. */
  accountType: 'owner' | 'member'
  name: string
  email: string
  password: string
  /** Only the rows that actually name a team — blank rows are not memberships. */
  memberships: IamMembership[]
}

export function validateAccountDraft(d: AccountDraft): AccountDraftIssue | null {
  if (!d.name.trim() || !d.email.trim() || d.password.length < 8) return 'incomplete-fields'
  if (!canCreateAccountWith(d.scope, d.memberships)) return 'team-required'
  return null
}

/**
 * Should the form state, in passing, that this account will belong to no team?
 *
 * Only when the draft is BOTH valid and teamless — a teamless account is invisible to and
 * unmanageable by every manager, and only the instance owner can administer it. That is coherent,
 * it is what the owner asked for, and it should not be a surprise discovered later. It is a HINT:
 * it never blocks, and it never appears where the account could not be created anyway (a manager
 * gets the `team-required` error instead, which says something different and more urgent).
 *
 * An owner-TYPE account is excluded: an owner has full access to every team by definition, so
 * "belongs to no team" says nothing about it. The drawer already explains that case in its own words.
 */
/** The slice of a team this form reads. `orgTeam` marks the one first-boot created for the org. */
export interface AssignableTeam {
  _id: string
  orgTeam?: boolean
}

/**
 * The membership rows a freshly-opened create drawer starts with.
 *
 *   - The organisation's team, when this principal can actually assign it — the convenience the
 *     org team exists for. PRE-SELECTED, never forced: the row has a bin like any other, and with
 *     it removed an owner creates a teamless account exactly as before.
 *   - Otherwise NOTHING for an owner. A form that opens on a blank team row implies a team is
 *     expected, and for an owner none is.
 *   - Otherwise one blank row for everyone else, who must fill it: a manager may only create
 *     accounts inside a team they manage.
 *
 * `assignableTeams` is already scoped by the caller (an owner sees every team, a manager only the
 * ones they manage), so an org team a manager does not manage is simply not among them and is not
 * pre-selected — the form never seeds a row the server would refuse.
 */
export function initialMembershipRows(
  scope: IamScope,
  assignableTeams: AssignableTeam[],
): IamMembership[] {
  const org = assignableTeams.find(t => t.orgTeam)
  if (org) return [{ teamId: org._id, role: 'user' }]
  return scope.role === 'owner' ? [] : [{ teamId: '', role: 'user' }]
}

export function showsTeamlessHint(d: AccountDraft): boolean {
  if (d.accountType === 'owner') return false
  if (!isOwnerOnlyAccount(d.memberships)) return false
  return canCreateAccountWith(d.scope, d.memberships)
}
