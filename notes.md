# manager-perms — review findings 1–5

Branch `feat/manager-perms`, on top of `947ee86`. Baseline before this work: **2206 pass / 0 fail**.
After: **2213 pass / 0 fail** (+8 new tests, −1 deleted tautology).

Every finding was reproduced RED before the fix. Where a finding had no reachable pure seam, one
was created (`proveStepUp`) rather than mocking the module registry — `bun test` runs every file in
one process, so a `mock.module('./accounts')` in this repo would leak into `accounts.test.ts`.

---

## 1 — `/api/iam/machines` minted credentials outside step-up

**RED.** New test `requiresStepUp > covers the machines route, which mints/rotates/revokes the SAME
token as /api/team/tokens`:

```
expect(requiresStepUp('POST', '/api/iam/machines')).toBe(true)
Expected: true   Received: false
1 fail
```

**GREEN.** `['/api/iam/machines', ['POST', 'DELETE']]` added to `PROTECTED` (`stepup.ts`).

Note on blast radius, deliberately taken: POST on that path also carries rename / re-own / re-team,
not only mint+rotate. Splitting one path into gated and ungated halves *by request body shape* is
not a boundary anyone can review, and the non-mint shapes decide who a credential answers to. All
of POST is gated.

**Wider than the finding, and required by it:** the finding named four `fetch` calls in
`UsersSettings.tsx`. `MachinesSettings.tsx` (5) and `TeamsSettings.tsx` (3) also *write* this route;
leaving them on bare `fetch` would have converted the fix into a broken Machines page — the first
403 has no retry path. **12 write call sites** across the three files are now `stepUpFetch`. Every
remaining `fetch('/api/iam/machines')` is a GET (verified by grep), which is correct: reads stay on
`fetch`.

## 2 — requiring TOTP at step-up was a total lockout

**RED.** `proveStepUp` did not exist; the test file failed at import:

```
SyntaxError: Export named 'proveStepUp' not found in module '.../stepup.ts'
0 pass / 1 fail / 1 error
```

**GREEN.** `proveStepUp(attempt, mfaEnrolled, verifiers)` in `stepup.ts` accepts a live TOTP **or**
a single-use recovery code when enrolled, and the password (only) when not. `handleStepUp` supplies
the real verifiers and writes `mfa.recovery_used` when a code is spent.

The same defect existed on two neighbouring paths the finding named, `DELETE /api/iam/mfa` and
`POST /api/iam/mfa/recovery-codes` — both demanded a live TOTP, so the authenticator was required
to disable the missing authenticator. Both now go through the shared `proveSecondFactor` helper
(same rule, same audit event). Clock-skew reporting is unchanged and now runs only after the
recovery attempt also fails.

## 3 — the step-up dialog silently failed for MFA-enrolled users

No automated RED available (no DOM test harness in this repo — `packages/web` tests are pure
functions only). The defect was confirmed by reading: `setError` had exactly two call sites in
`StepUpPrompt.tsx`, both `setError(false)`, so the `error` block was dead code; `mintGrant` returned
`null` on any non-OK response and `stepUpFetch` then returned the original 403 with no second
prompt.

**Fixed on both sides:**

- Server: the 401 from `/api/iam/stepup` now carries `mfaRequired: stepUpRequiresCode(!!mfa)`. Not
  an oracle — the caller is already authenticated *as that account* and can read the same fact from
  `GET /api/iam/mfa`.
- Client (`lib/stepup.ts`): `factorNeeded()` probes `GET /api/iam/mfa` **before** opening the
  dialog, and `mintGrant` loops up to 3 refusals, re-prompting with `{ needsCode, retry }`. A 401 is
  retried (wrong credential); a 429/500 is not (not fixable by retyping — do not hammer a
  rate-limited endpoint). An unreachable probe falls back to the password, and the server's own
  refusal then corrects the mode.
- Dialog: opens in code mode when enrolled, the copy names the authenticator **and** the recovery
  code, `error` is now genuinely set on a retry, and the "use password instead" escape is hidden
  when enrolled — offering a factor the server will refuse is the original bug in miniature.

**Mobile** (part of the deliverable): `useIsMobile()` gates `minHeight: 44` on the input, the submit
button and both link buttons. Mobile only — 44px on a pointer just bloats the card. The input keeps
its existing `fontSize: 16` (≥16 satisfies the iOS zoom rule; no new inline font-size was added,
and the global `index.css` guard is untouched). No new fixed widths, so the 390px overflow
invariant is unaffected. Added `autoComplete="one-time-code"` in code mode.

## 4 — every new audit event hardcoded `ip: 'unknown'`

**RED.** Static, not a test: `grep -n "ip: 'unknown'" iam-handlers.ts` returned all ten lines the
finding named.

**GREEN.** `handleAccounts(req, ip)`, `handleMachines(req, ip)`, `handleStepUp(req, ip)` — the
shape `handleRecover(req, clientIp)` already used — plus `handleMfa(req, pathname, ip)`, which had
to join them because finding 2 *adds* `mfa.recovery_used` writes there and a new hardcoded
`'unknown'` is the very defect under review. `index.ts` passes `clientIp` at all four call sites.
`password.reset_admin` now records where from. No new `meta` field carries a credential, password,
token or hash (the one added is `factor: 'password' | 'totp' | 'recovery'`).

Deliberately left: `handleIamLoginMfa` (lines 195/199/200) and `handleChangePassword` (633) still
pass `'unknown'`. Neither was in the finding and neither is an admin action on a third party; they
are the same one-line change when someone wants it.

## 5 — the security change itself was untested

Deleted the tautology `expect(f(true)).toBe(f(true))` — at `stepup.test.ts:109-115` in the tree,
not `:625-630` as the finding said (that file is 115 lines long); same test, the line number in the
review was wrong.

Added `describe('proveStepUp')` — 7 tests over injected verifiers, no DB, no clock, no locale:

- a **correct** password is refused on an enrolled account, **and `verifyPassword` is never called**
  (the recorded call list is the assertion — "was it even consulted" is the property that matters);
- a live TOTP succeeds without spending a recovery code;
- a recovery code succeeds when TOTP fails;
- a recovery code is **single-use** — the replay fails and the store is empty;
- an empty code asks nothing of the store;
- unenrolled: the password decides, and a code is never a substitute for it.

Honest limitation: `handleStepUp` itself is still not executed by a test, because it needs Mongo,
argon2 and a live TOTP secret. What the test covers is the whole of the decision it delegates —
the handler is now three lines of wiring that pass the real verifiers in. This is the same reason
`proveStepUp` takes its verifiers as parameters rather than importing them.

---

## Explicitly not touched

The seven deferred items (inline owner-creation guard, the stale doc comment at `:218-219`,
malformed `memberships`, unaudited rename-bundled-with-reset, machines minted during account
creation, team DELETE membership rewrite, `RULES.login`'s inert `backoff`).
