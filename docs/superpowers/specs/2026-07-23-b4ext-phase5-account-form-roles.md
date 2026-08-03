# B4-EXT Phase 5 — role-model simplification + account form redesign (spec)

**Date:** 2026-07-23
**Follows:** B4-EXT Phases 1–4 + the admin-role addition (now being reverted per owner feedback).
**Language:** English (code/comments/commits).

## 1. Decisions (locked from owner feedback)

### Roles — drop `admin`, keep owner + manager + user
- Revert the global `admin` account role added in `63a9aeb`/`bfc7d1b`. Account roles return to
  `owner | member`; `manager`/`user` remain **team-scoped** roles inside `memberships`.
- **Keep** the good parts of `63a9aeb`: owner may delete other owners **with last-owner protection**
  (`countOwners()`), and owner may edit any account.
- **Only owner and manager may create accounts** (users cannot). This already holds
  (`canCreateAccount`): owner → anything; a member with a `manager` membership → `user`-role
  memberships in teams they manage.

### Creation/edit scoping (manager is scope-bounded)
- **owner:** full access — assign any teams and link any machines to any account.
- **manager:** may create **user** accounts and may only assign **teams they manage** and link
  **machines within their managed teams**. Example: a manager scoped to teams A,B (of A–F) creating
  a user sees only A,B as assignable — enforced server-side (`canCreateAccount`, `canManageMachineTeam`),
  mirrored client-side (the pickers only list in-scope teams).

### Machines: linking (bind) ≠ visualization
- **Linking a machine to an account** is a literal ownership bind: it mints a machine **token** for
  that account (machine X,Y,Z belong to account). This is separate from **view permission**
  (team memberships / who can *see* which teams/machines).
- Both **account creation** and **account edit** must offer **linking one or more machines**:
  - a machine **name** field (required per machine),
  - **add several machines at once** — each mints its **own** token (distinct per machine),
  - all generated tokens shown **once** (name + token + `agentop member connect` command, copyable).

### Form quality
- Redesign the create/edit account drawer; replace raw browser checkboxes with the project's styled
  controls (Toggle/checkbox primitives), consistent spacing/hierarchy.

## 2. Backend

- `iam-types.ts`: `Role = 'owner' | 'member'` (remove `admin`). Keep the hierarchy comment sans admin.
- `iam-view.ts`: remove `admin` branches from `accountVisibleTo`, `canCreateAccount`,
  `canDeleteAccount`, `teamVisibleTo`, `canManageMachineTeam`; **remove `canAssignRole`** (owner mints
  owner/any; manager mints scoped members — handled inline). Keep `canDeleteAccount`: owner→anyone
  (last-owner guard in handler), manager→user-members in managed teams.
- `iam-handlers.ts`:
  - POST: `role = b.role === 'owner' ? 'owner' : 'member'`; authz `if (role==='owner') require owner
    else canCreateAccount(principal, memberships)`. Accept **`machines?: {name:string; teamId?:string}[]`**
    (plus keep single `machine?:{name}` as a one-element alias). After creating the account, for each
    requested machine, gate `canManageMachineTeam(principal, teamId ?? account's team)` and mint a token;
    return `machineTokens: {name, token}[]`.
  - PATCH: owner-branch condition back to `target.role === 'owner'` (no admin); keep self=rename-only,
    last-owner untouched.
  - DELETE: keep last-owner guard.
- `accounts.ts`: keep `countOwners`.
- Machines already have `POST /api/iam/machines` for edit-time linking (one token per call).

## 3. Frontend

- Remove `admin` everywhere: `App.tsx` `IamAccount.role`, `app-context.ts` `Principal.role`,
  `UsersSettings`/`TeamsSettings` local `Account.role` → `'owner' | 'member'`; drop admin badge/legend/
  selector option; `settingsSections` governance access = central && (owner || isManager).
- **Create account drawer** (redesigned):
  - Account type: member vs owner (owner option only for an owner viewer).
  - **Teams (scope)** editor: rows of {team, role}. Team options limited to the viewer's managed teams
    when the viewer is a manager (owner sees all). Role select: manager assigns `user` only; owner may
    assign `manager`/`user`.
  - **Link machines** editor: repeatable rows of {machine name (required), team (optional, in-scope)};
    "Add machine" adds a row. On submit, the account is created then each machine is minted; the
    shown-once result panel lists **every** machine with its token + connect command (copyable), with
    the no-close-while-secret guard.
  - Styled checkboxes/toggles; cleaner layout.
- **Edit account drawer** (redesigned): teams editor (scoped) + **linked machines** section listing the
  account's current machines (name/team/last-seen) with **Add machine** (mints one token, shown once)
  and revoke; reset password (existing). Styled controls.
- Client mirrors of scope (managed-teams filter) are advisory; server enforces.

## 4. Phasing
1. Backend: revert admin + multi-machine create (pure helpers unit-tested; handler integration by curl/UI).
2. Frontend: remove admin + redesigned create/edit drawers (teams scoped + multi-machine link + styled).

## 5. Non-goals
- Machine IP capture (not collected today) — separate follow-up.
- Changing the team-scoped nature of manager/user.
