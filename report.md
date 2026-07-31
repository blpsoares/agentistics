# Notification scoping by role/team entitlement

## Subject model

Added `subject?: { kind: 'machine' | 'team' | 'account' | 'tag'; id: string }` to
`NotificationInput`/`StoredNotification` (`notifications-store.ts`). Set by the emitter; absent =
instance-wide.

New pure module `packages/server/server/notifications-authority.ts` exports
`subjectVisibleTo(principal, subject, ctx)`. It does not reimplement entitlement — it dispatches
to the authority that already governs the corresponding surface:
- `team` -> `teamVisibleTo` (iam-view.ts) — same rule as the team list.
- `machine` -> `canManageMachine` (iam-view.ts) — same rule as the machine-admin routes.
- `account` -> `accountVisibleTo` (iam-view.ts) — same rule as the accounts panel.
- `tag` -> caller-supplied `readableTagIds` set, meant to be filled via `tags-authority.ts`'s
  `canReadTag` (not wired yet — nothing currently emits a tag-scoped notification, so it stays an
  always-empty, fail-closed set rather than a guessed resolution).

`NotificationAuthorityContext` (machines/accountMemberships/readableTagIds) is built once per
request in the new `notifications-context.ts` (fetches `listMachines()` + `listAccounts()`), and
attached to `Viewer` as an optional `entitlement: { principal, ctx }` in `index.ts`'s
`/api/notifications` handler. `visibleTo()` in `notifications-store.ts` stays pure: it just calls
`subjectVisibleTo` when `viewer.entitlement` is present.

## Unattributed notifications

No subject = instance-wide, delivered to every authenticated account regardless of role. Rationale:
an update banner or central-level notice has no single owner to scope it to, and hiding it from
everyone but the owner would silence a message every account genuinely needs. This is a deliberate,
documented choice in the module's own comment, not a default that fell out of the code.

## Existing (pre-migration) rows

No migration needed or performed. A stored row with no `subject` field is indistinguishable from a
deliberately-instance-wide one, so it is treated the same way: visible to everyone, still subject to
the pre-existing `hiddenFor` / `CODES_NAMING_A_PERSON` (name-redaction) checks, which never changed.
Concretely: history for `central.member_connected` (already named-person-gated) is unaffected; a
historical `iam.reset_requested` row (previously visible to every account) stays visible to every
account, and only newly emitted rows of that code are narrowed by the account subject added below.
This was the explicit trade-off: no surprise hide, no surprise reveal, only going-forward
improvement.

## Emitters updated

- `team-agent.ts` `registerAgent` -> `central.member_connected` now carries `subject: { kind:
  'machine', id: memberId }`.
- `iam-handlers.ts` `iam.password_recovered` -> `subject: { kind: 'account', id: account._id }`
  (previously reached every account on the central; now the affected account, the owner, and a
  manager of one of its teams).
- `iam-handlers.ts` `iam.reset_requested` -> `subject: { kind: 'account', id: account._id }` (payload
  stays anonymous — no email/reason — only delivery is scoped).

Member-side codes (`machine.renamed`, `machine.reassigned`, `team-uploader.ts` connection
notifications) were left without a subject: they only ever fire on a solo/member machine, which has
no accounts and always uses `localViewer` (`entitlement` absent -> sees everything, unchanged).

## localViewer / solo machines

Unaffected: `localViewer` has no `entitlement`, so `visibleTo` skips the subject check entirely —
same as before this change. Verified by a dedicated regression test.

## RED

```
$ bun test packages/server/server/notifications-authority.test.ts
error: Cannot find module './notifications-authority' ...
0 pass, 1 fail

$ bun test packages/server/server/notifications-store.test.ts
... 4 failing (subject/entitlement ignored, everything visible) ...
38 pass, 4 fail
```

## GREEN

```
$ bun test packages/server/server/notifications-authority.test.ts packages/server/server/notifications-store.test.ts
58 pass, 0 fail, 90 expect() calls

$ bun tsc --noEmit
(clean)

$ bun test
2219 pass, 0 fail, 19993 expect() calls   (baseline: 2195 pass / 0 fail; +24 new tests)
```

## Concerns / follow-ups

- `buildNotificationAuthorityContext()` fetches all machines + all accounts on every
  `/api/notifications` call (GET/POST/PATCH/DELETE). Fine at current scale (mirrors the per-request
  context-building pattern in `team-scope.ts`/`tags-handlers.ts`), but a high-traffic central polling
  the bell frequently would want this cached/memoized per request cycle rather than per call.
- Tag subject is modeled but not wired to any emitter or to `tags-authority.ts`'s `canReadTag` yet —
  documented in `notifications-context.ts` as the next step if a tag-scoped notification is ever
  added.
