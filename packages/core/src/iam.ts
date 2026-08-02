/**
 * iam.ts — PURE: the membership-scope rule for creating an account, shared by BOTH sides.
 *
 * Why it lives in core: the server has always been the authority (`canCreateAccount` in
 * `iam-view.ts`), but the create form has to say NO before the request is sent, or the user meets a
 * 403 instead of a sentence. Written twice, the two drift — and the frontend copy drifted first: it
 * demanded at least one team from EVERY principal, owner included, while the server had never
 * required one of an owner. So the rule is stated once here and imported by both; `packages/web`
 * cannot import `packages/server`, which is exactly what core exists for.
 *
 * The rule, and why each half is what it is:
 *
 *   - An OWNER may assign anything, including NOTHING. A team is not paperwork for an owner: an
 *     account with no membership is simply invisible to and unmanageable by every manager, and the
 *     owner (who sees every account regardless of team) can still administer it.
 *   - A MANAGER must place the account in a team they manage, with a `user` role. Here the
 *     requirement is not paperwork either — it is the BOUNDARY. Team membership is the scope key
 *     for authorization (`accountVisibleTo` / `canDeleteAccount` / `teamVisibleTo` all read it), so
 *     an account a manager creates outside their own teams is one they created and cannot see,
 *     which is the definition of acting beyond scope.
 *
 * Deliberately structural (`IamScope`, not the server's `Principal`): the server's `Principal`
 * carries an `accountId` this decision must never read, and the web's `Principal` carries a name
 * and an email. Both satisfy this shape as they stand.
 */

export type IamRole = 'owner' | 'member'
export type IamTeamRole = 'manager' | 'user'

export interface IamMembership {
  teamId: string
  role: IamTeamRole
}

/** The slice of a principal this decision reads — never the identity, only the scope. */
export interface IamScope {
  role: IamRole
  memberships: IamMembership[]
}

/** The teams a principal manages (the set every scope question below is asked against). */
export function managedTeamIds(scope: IamScope): Set<string> {
  return new Set(scope.memberships.filter(m => m.role === 'manager').map(m => m.teamId))
}

/**
 * May `scope` create an account carrying exactly `memberships`?
 *
 * Owner: always — an empty list included. Anyone else: at least one membership, every one of them
 * a `user` role inside a team they manage.
 */
export function canCreateAccountWith(scope: IamScope, memberships: IamMembership[]): boolean {
  if (scope.role === 'owner') return true
  const managed = managedTeamIds(scope)
  return memberships.length > 0 && memberships.every(m => m.role === 'user' && managed.has(m.teamId))
}

/**
 * Does this membership list leave the account reachable by NOBODY but the instance owner?
 *
 * True only for the empty list — a teamless account. It is a legitimate thing to create (see
 * above), and it is also a surprising one, so the form states it. This is a QUESTION, never a
 * veto: `canCreateAccountWith` already decides what is allowed.
 */
export function isOwnerOnlyAccount(memberships: IamMembership[]): boolean {
  return memberships.length === 0
}
