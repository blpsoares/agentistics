# Manager account/machine administration + step-up second-factor requirement

## Starting point — most of the product ask already existed

Before writing anything I read the full route surface end-to-end (`iam-handlers.ts`, `iam-view.ts`,
`iam-caps.ts`, `stepup.ts`, `audit.ts`, plus the web `UsersSettings.tsx`) and found the core feature
was already built in a prior session:

- `PATCH /api/iam/accounts` already accepts `{ id, resetPassword: true }` and is already scoped by
  `canDeleteAccount` (owner -> anyone; manager -> only user-role members of teams they manage).
- `POST /api/iam/machines` (mint/rename/rotate/reassign-owner/reassign-team) and
  `DELETE /api/iam/machines` are already scoped by `canManageMachine` (owner, a manager of any of the
  machine's teams, or an owner-account of the machine itself).
- `PATCH /api/iam/accounts` is already in `stepup.ts`'s `PROTECTED` table, so an admin resetting
  someone else's password already needs a step-up grant.
- The web UI (`packages/web/src/pages/settings/UsersSettings.tsx`) already calls `resetPassword`
  through `stepUpFetch` (never bare `fetch`), and already has account-edit and machine
  add/rename/rotate UI wired up.

So the genuine gaps this session actually needed to build were:

1. Step-up accepted a password alone even when the account had a second factor enrolled (silently
   defeating MFA for exactly the scenario the ask is worried about — a stolen session plus a
   stolen password).
2. `audit.ts` declared `account.create` / `account.update` / `account.delete` /
   `token.mint` / `token.rotate` / `token.revoke` in its `AuditAction` union, but none of them were
   ever actually written by `iam-handlers.ts` — account and machine admin actions left no trail.
3. The admin password-reset path had no rate limit of its own (only the generic per-IP ceiling
   already applied to every route in `index.ts`).

I also extracted the inline PATCH-authorization logic into one named, pure, directly-testable
function so the "no escalation" guarantees are explicit tests rather than implicit in a route body.

## 1. Entitlement authority — extended, not duplicated

File: `packages/server/server/iam-view.ts`

Added `authorizeAccountPatch(principal, target, { name?, memberships?, resetPassword? })` — pure,
no I/O — the single gate for both "edit an account" and "admin-reset a password" (they must never
drift apart on who may act on whom). It:
- reuses the EXISTING `canDeleteAccount` (same scope as deletion) and `canAssignMemberships`
  (membership reassignment) rather than inventing parallel rules,
- takes an `AccountPatchRequest` type that has NO `role` field at all — role escalation through
  this endpoint isn't merely checked against, it's inexpressible in the type,
- refuses self-edits of memberships/resetPassword, refuses an owner-target's memberships from a
  non-owner-target patch, and refuses anything a manager can't already delete.

`iam-handlers.ts`'s PATCH handler now calls this one function instead of the inline `isSelf` /
`isOwner` branching it had before.

## 2. Routes touched (no new routes — the existing ones were completed)

| Route | Change |
|---|---|
| PATCH /api/iam/accounts (already step-up gated in stepup.ts) | now goes through authorizeAccountPatch; writes password.reset_admin audit on reset, account.update otherwise; rate-limited per actor on reset |
| POST /api/iam/accounts | now writes account.create audit |
| DELETE /api/iam/accounts | now writes account.delete audit |
| POST /api/iam/machines (mint / rename / rotate / owner-reassign / team-reassign) | now writes token.mint / machine.update (x3) / token.rotate audit |
| DELETE /api/iam/machines | now writes token.revoke audit |
| POST /api/iam/stepup | now requires the second factor when one is enrolled (see 3) |

No new stepup.ts PROTECTED entries were needed — /api/iam/accounts (POST/PATCH/DELETE) was already
listed. Machine routes remain outside step-up, unchanged from before this session (a
credential-minting action there is arguably as sensitive as an account edit; left as documented
follow-up rather than silently expanding scope not asked for in the "decisions already made" list).

## 3. Second-factor requirement at step-up

File: `packages/server/server/stepup.ts`, function `stepUpRequiresCode(mfaEnrolled: boolean): boolean`.

It takes NO role parameter — the property under test is exactly that an owner and a manager with
TOTP enrolled are held to the identical rule. `handleStepUp` (`iam-handlers.ts`) now fetches the
account's MFA state once and, when `stepUpRequiresCode(!!mfa)` is true, verifies ONLY the TOTP
code — a submitted password is no longer accepted as an alternative. When no second factor is
enrolled, the password path works exactly as before (enrollment stays optional, never mandatory).

## 4. Escalation tests (explicit, per the ask)

`packages/server/server/iam-view.test.ts`, `describe('authorizeAccountPatch', ...)`:
- "a manager can never escalate a target to owner" — an owner target is refused for every patch
  shape, including a harmless rename.
- "a manager cannot assign memberships into a team they do not manage" — refused for team B,
  allowed for their own team A.
- "a manager cannot edit their own role or memberships through this path" — refused for
  memberships/resetPassword on self, allowed for a plain rename of self.

Plus tests for the owner path (may edit anyone but not another owner's memberships), the positive
manager-reset-a-managed-user case, and a manager acting on a fully out-of-scope account.

## 5. Audit

`packages/server/server/audit.ts` gained two new AuditAction variants:
- `password.reset_admin` — kept distinct from the existing `password.change` (self-service) so an
  incident review can tell "I changed my own password" from "someone else reset mine" at a glance.
- `machine.update` — kept distinct from token.mint/token.rotate/token.revoke, which touch the
  credential itself; machine.update covers name/owner/team changes.

All new audit writes go through the existing writeAudit() (fire-and-forget, redacts secret-shaped
fields via buildAuditEvent) — no new field carries a credential.

## 6. Rate limiting

PATCH /api/iam/accounts with resetPassword: true is now limited per ACTING account
(admin-reset:<actorId>, RULES.login shape — 5/15min, doubling backoff) on top of the existing
generic per-IP ceiling in index.ts. This bounds how many accounts one session (e.g. a stolen
manager cookie) can reset in a burst, independent of source IP.

## What was deliberately left out

- Machine mutation routes are not step-up gated. They were not before this session either; the
  ask's explicit "decisions already made" list only calls out password reset. Flagging as a
  reasonable follow-up given token.mint/token.rotate mint credentials.
- handleTeams (team create/delete) still has no audit writes. Same "declared but unused" gap
  exists there (team.create/team.update/team.delete), but it's outside this feature's scope (not
  mentioned in the ask) — noted for a future pass.
- No new web UI was built — the existing UsersSettings.tsx already implements reset/edit/machine
  management via stepUpFetch; nothing needed changing there for this session's fixes (the
  second-factor requirement is transparent to the UI: it still POSTs {password} or {code} to
  /api/iam/stepup and gets a 401 to retry with a code, same contract as before).

## RED (before implementation)

    packages/server/server/stepup.test.ts:
    SyntaxError: Export named 'stepUpRequiresCode' not found in module '.../stepup.ts'.
    packages/server/server/iam-view.test.ts:
    SyntaxError: Export named 'authorizeAccountPatch' not found in module '.../iam-view.ts'.

     6 pass
     2 fail (2 files errored on missing exports)

## GREEN (final)

    $ bun test
     2206 pass
     0 fail
     19976 expect() calls
    Ran 2206 tests across 134 files. [14.08s]

    $ bun tsc --noEmit
    (no output — clean)

Baseline was 2195 pass / 0 fail; this session adds 11 new tests, 0 regressions.

## Files touched

- packages/server/server/iam-view.ts — authorizeAccountPatch + AccountPatchRequest
- packages/server/server/iam-view.test.ts — escalation tests
- packages/server/server/stepup.ts — stepUpRequiresCode
- packages/server/server/stepup.test.ts — tests for it
- packages/server/server/audit.ts — password.reset_admin, machine.update action types
- packages/server/server/audit.test.ts — tests for the new action types
- packages/server/server/iam-handlers.ts — wires all of the above into the routes
