# Manager direct grants (loose machines/users) — design spec (Option A)

**Date:** 2026-07-23 · **Roadmap:** C6 · **Status:** 🟨 spec (build + security-review next session)
**Language:** English (code/comments/commits).

## 1. Problem
Today a manager's scope is **purely team-based**: a `member` account with a `manager`-role membership
on team T manages everything in T (its machines + user accounts). The owner wants to also grant a
manager **standalone ("avulso") machines and users** that are NOT in a team the manager manages.

## 2. Decision — Option A: explicit direct grants on the account
Add two optional arrays to the manager's account (`AccountDoc`):
```ts
managedMachineIds?: string[]   // machine token hashes this account may view/manage directly
managedAccountIds?: string[]   // user accounts this account may view/manage directly
```
These are ADDITIVE to team-manager memberships. (Owner still sees everything; a plain `user` gets
none.) Rejected Option B ("put the loose thing in a team the manager manages") because the owner
explicitly wants grants outside any team.

## 3. Backend changes (authz — needs a dedicated security review)
- `iam-types.ts` `AccountDoc` + `Principal`: carry `managedMachineIds`/`managedAccountIds`.
  `getPrincipal` (auth.ts) must load them onto the Principal from the account doc.
- `iam-view.ts`:
  - `accountVisibleTo(p, acc)` → also true when `acc._id ∈ p.managedAccountIds`.
  - `canManageMachine(p, machine)` → also true when `machine.id ∈ p.managedMachineIds`.
  - Keep owner/team paths unchanged.
- **Data scoping** (`team-scope.ts` `visibleTeamIdsOf`/`scopeAppDataToTeams`, applied in `/api/data`
  for non-owners): today it filters sessions to the principal's visible teams. Extend so a
  non-owner ALSO sees sessions whose `memberId ∈ managedMachineIds` OR whose owning user is a
  `managedAccountIds` account. (Sessions carry `memberId` + `user` now — added in C3.) This is the
  trickiest part: the scope function must union team-scoped sessions with directly-granted ones.
- `PATCH /api/iam/accounts`: accept `managedMachineIds`/`managedAccountIds` edits — **owner only**
  (a manager must not widen their own grants). Validate each id exists.
- `iam-caps`/tests: extend the capability matrix + `team-scope.test.ts` with grant cases.

## 4. Frontend
- Account **create + edit** drawer, for a `member` being made a **manager**: alongside the team
  scope rows, add **"Extra machines"** (multi-select of machines) + **"Extra users"** (multi-select
  of member accounts) pickers — visible only to an owner editor, only when the account has ≥1
  manager membership (or always, applied regardless of role). Persist via the account POST/PATCH.
- The Machines/Users lists a manager sees then include their directly-granted items automatically
  (server-scoped).

## 5. Sequencing (per the session-close recommendation)
Build this **after** the pending whole-branch security review of the recent batch — it adds a
**second authz axis** (grants beyond teams), so it must land reviewed, with `team-scope` tests, not
stacked blind on unreviewed code. #1 (flexible machine linkage, loose/team/owner/both) already
shipped (`d5dbd3c`).

## 6. Non-goals
- Managers granting themselves (owner-only edits).
- Nested/transitive grants.
