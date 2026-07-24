# B4-EXT Phase 2 — Frontend accounts (create-with-machine, edit, first-login change) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the central admin's **account** UI to the Phase-1 backend: create accounts with an optional machine + random password + forced first-login change, edit accounts (name / memberships / reset password), and a **blocking** first-login change-password screen.

**Architecture:** Frontend-only React/Vite work in `packages/web/src`. All calls hit same-origin `/api/iam/*` with raw `fetch` (session cookie sent automatically) — the established pattern in `UsersSettings.tsx`/`TeamsSettings.tsx`. The Phase-1 server already returns every field/response shape this phase consumes (`mustChangePassword` on `/me` + login, `machineToken` on create, `tempPassword` on PATCH-reset, `POST /api/iam/change-password`). We add: one pure helper (`generatePassword`, unit-tested), thread `mustChangePassword` through the IAM state + context types, a new blocking `ChangePassword` screen inserted in the App gate, and extend the Users page create/edit drawers.

**Tech Stack:** Bun, TypeScript (strict, no `any`), React 18, react-router-dom, lucide-react. No new dependencies.

## Global Constraints

- **English only** — code, comments, commits, UI copy (with `pt`/en bilingual strings following the existing `lang === 'pt'` pattern already used in `UsersSettings.tsx`).
- **TypeScript strict, no `any`.** Commit subjects lowercase, Conventional Commits (`feat:`/`fix:`), scope `iam`.
- **No shared fetch helper exists** — inline `fetch('/api/iam/...')` with `headers: { 'Content-Type': 'application/json' }`, same-origin (no `credentials`). On `!res.ok`, read `{ error?: string }` and surface `d.error || \`HTTP ${res.status}\``.
- **Server enforces all authz** — UI gating is advisory only. Never assume the client can bypass a 403.
- **Secrets shown once** — machine tokens and temp/random passwords are displayed once in the drawer after the mutation; there is no re-fetch endpoint. Provide a copy affordance and make it visually distinct.
- **Owner accounts** have no team scope (`role: 'owner'`, empty `memberships`); member accounts require ≥1 membership.
- After every task: `bun tsc --noEmit` clean + `bun test` green. Component tasks additionally require `bun run build` to succeed (Vite typecheck of the web package).
- **PWA caveat:** after a rebuild the service worker may serve a stale bundle — verify built output via the compiled asset, and when the user tests, tell them to hard-reload / use incognito (see repo memory `pwa-sw-cache-masks-rebuilds`).

---

### Task 1: `generatePassword` pure helper (TDD)

**Files:**
- Create: `packages/web/src/lib/password.ts`
- Test: `packages/web/src/lib/password.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `generatePassword(length?: number): string` — a cryptographically-random password using `crypto.getRandomValues`. Default length 16; drawn from an unambiguous alphabet (no `0/O/1/l/I`). Always ≥ 12. Used by the create-account drawer (Task 4).

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/lib/password.test.ts
import { test, expect } from 'bun:test'
import { generatePassword } from './password'

test('generatePassword returns the requested length', () => {
  expect(generatePassword(16)).toHaveLength(16)
  expect(generatePassword(24)).toHaveLength(24)
})

test('generatePassword defaults to 16 chars', () => {
  expect(generatePassword()).toHaveLength(16)
})

test('generatePassword enforces a 12-char floor', () => {
  expect(generatePassword(4).length).toBeGreaterThanOrEqual(12)
})

test('generatePassword uses only the unambiguous alphabet', () => {
  const pw = generatePassword(200)
  expect(/^[A-HJ-NP-Za-hj-km-z2-9!@#$%^&*_-]+$/.test(pw)).toBe(true)
  // no ambiguous chars
  expect(/[0O1lI]/.test(pw)).toBe(false)
})

test('generatePassword is effectively unique across calls', () => {
  const seen = new Set(Array.from({ length: 50 }, () => generatePassword(16)))
  expect(seen.size).toBe(50)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/mithrandir/agentistics && bun test packages/web/src/lib/password.test.ts`
Expected: FAIL — `Cannot find module './password'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/src/lib/password.ts
// Unambiguous alphabet — excludes 0/O/1/l/I so a shown-once password is easy to read aloud/copy.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*_-'

/** Cryptographically-random password from an unambiguous alphabet. Min length 12, default 16. */
export function generatePassword(length = 16): string {
  const len = Math.max(12, length)
  const out = new Array<string>(len)
  const bytes = new Uint32Array(len)
  crypto.getRandomValues(bytes)
  for (let i = 0; i < len; i++) out[i] = ALPHABET[bytes[i] % ALPHABET.length]
  return out.join('')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/mithrandir/agentistics && bun test packages/web/src/lib/password.test.ts`
Expected: PASS (5 tests). Then `bun tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/password.ts packages/web/src/lib/password.test.ts
git commit -m "feat(iam): add generatePassword helper for admin-created accounts"
```

---

### Task 2: Thread `mustChangePassword` through IAM state + context types

**Files:**
- Modify: `packages/web/src/lib/app-context.ts:19-25` (the `Principal` interface)
- Modify: `packages/web/src/App.tsx:68` (the `IamAccount` interface) and `packages/web/src/App.tsx:1036-1044` (`reloadIam`)

**Interfaces:**
- Consumes: `/api/iam/me` → `{ authed: true, account: PublicAccount }` where `PublicAccount.mustChangePassword: boolean` (already returned by the server).
- Produces: `Principal.mustChangePassword: boolean` and `IamAccount.mustChangePassword: boolean`, populated on `iam.account`. Consumed by Task 3 (gate) and available to all pages via `useOutletContext<AppContext>().me`.

- [ ] **Step 1: Add the field to `Principal`**

In `packages/web/src/lib/app-context.ts`, extend the `Principal` interface (lines 19-25) to:

```ts
export interface Principal {
  id: string
  name: string
  email: string
  role: 'owner' | 'member'
  memberships: { teamId: string; role: 'manager' | 'user' }[]
  /** Forces a blocking first-login password change when true (B4-EXT). */
  mustChangePassword: boolean
}
```

- [ ] **Step 2: Add the field to `IamAccount`**

In `packages/web/src/App.tsx:68`, change:

```ts
export interface IamAccount { id: string; name: string; email: string; role: 'owner' | 'member'; memberships: { teamId: string; role: 'manager' | 'user' }[] }
```

to:

```ts
export interface IamAccount { id: string; name: string; email: string; role: 'owner' | 'member'; memberships: { teamId: string; role: 'manager' | 'user' }[]; mustChangePassword: boolean }
```

- [ ] **Step 3: Verify `reloadIam` threads it (no code change expected)**

`reloadIam` (App.tsx:1036-1044) already does `account: me.account`, so the new field flows through as long as `/api/iam/me` returns it. Confirm the block reads (leave as-is if it already matches):

```ts
.then(([st, me]) => setIam({ needsBootstrap: !!st.needsBootstrap, authed: !!me.authed, account: me.account }))
```

No change needed here — this step is a verification checkpoint only.

- [ ] **Step 4: Verify types compile**

Run: `cd /home/mithrandir/agentistics && bun tsc --noEmit`
Expected: clean. (If any existing object literal constructs an `IamAccount`/`Principal` without `mustChangePassword`, add `mustChangePassword: false` there — grep `mustChangePassword` and `IamAccount` to confirm none exist besides the type + `me.account` passthrough.)

Run: `cd /home/mithrandir/agentistics && bun test`
Expected: all green (no behavior change).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/app-context.ts packages/web/src/App.tsx
git commit -m "feat(iam): thread mustChangePassword through IAM state + context types"
```

---

### Task 3: Blocking first-login change-password screen + App gate

**Files:**
- Create: `packages/web/src/components/ChangePassword.tsx`
- Modify: `packages/web/src/App.tsx` (import at top with the other component imports; gate insertion at ~line 1728, right after the `!iam.authed` `Login` line)

**Interfaces:**
- Consumes: `IamAccount.mustChangePassword` (Task 2); `POST /api/iam/change-password` → body `{ currentPassword?: string, newPassword: string }`, success `{ ok: true }` + re-issued `Set-Cookie`, errors 400/401/404 `{ error }`.
- Produces: `ChangePassword` React component (named export) rendered as a full-screen blocking gate when `iam.account?.mustChangePassword` is true.

**Design note:** This is a *forced* first-login change, so the server does **not** require `currentPassword` (it skips the check when `account.mustChangePassword` is true). The screen therefore collects only **new password** + **confirm**. On success, call `onDone()` which re-runs `reloadIam()` (clears the flag) + `refetch()`.

- [ ] **Step 1: Create the component**

```tsx
// packages/web/src/components/ChangePassword.tsx
import React, { useState, useRef, useEffect } from 'react'
import { AlertCircle, KeyRound } from 'lucide-react'
import { Field } from './Login'

/** Blocking first-login password change (mustChangePassword). Forced flow — the server does not
 *  require the current password. Posts /api/iam/change-password; the server re-issues the cookie. */
export function ChangePassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  const tooShort = password.length < 8
  const mismatch = confirm.length > 0 && password !== confirm
  const disabled = submitting || tooShort || password !== confirm

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (disabled) return
    setSubmitting(true); setError(null)
    try {
      const res = await fetch('/api/iam/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: password }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (res.ok && data.ok) onDone()
      else setError(data.error || `HTTP ${res.status}`)
    } catch { setError('Network error — try again.') } finally { setSubmitting(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', padding: 16 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 380, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 28, boxShadow: '0 12px 40px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ display: 'inline-flex', padding: 9, borderRadius: 10, background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)' }}><KeyRound size={18} /></span>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>Set a new password</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5, margin: '0 0 18px' }}>
          Your account was created with a temporary password. Choose a new one to continue.
        </p>
        <Field label="New password" type="password" value={password} onChange={setPassword} inputRef={ref} disabled={submitting} />
        <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} disabled={submitting} />
        {(mismatch || error) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#ef4444', marginBottom: 12 }}>
            <AlertCircle size={13} /> {mismatch ? 'Passwords do not match.' : error}
          </div>
        )}
        <button type="submit" disabled={disabled}
          style={{ width: '100%', padding: '9px 14px', borderRadius: 8, border: '1px solid var(--anthropic-orange)', background: disabled ? 'var(--bg-elevated)' : 'var(--anthropic-orange-dim)', color: disabled ? 'var(--text-tertiary)' : 'var(--anthropic-orange)', fontSize: 13, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          {submitting ? 'Saving…' : 'Save & continue'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Import it in App.tsx**

Find the import of `OwnerSetup`/`Login` near the top of `packages/web/src/App.tsx` (grep `from './components/OwnerSetup'` and `from './components/Login'`) and add alongside them:

```ts
import { ChangePassword } from './components/ChangePassword'
```

- [ ] **Step 3: Insert the gate**

In `packages/web/src/App.tsx`, inside the `if (teamSession.central) { ... }` block (currently lines 1725-1728), add the new line **after** the `!iam.authed` Login line:

```ts
  if (teamSession.central) {
    if (iam === undefined) return <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }} />
    if (iam.needsBootstrap) return <OwnerSetup onDone={() => { reloadIam(); refetch() }} />
    if (!iam.authed) return <Login onAuthed={() => { reloadIam(); refetch() }} />
    if (iam.account?.mustChangePassword) return <ChangePassword onDone={() => { reloadIam(); refetch() }} />
  }
```

- [ ] **Step 4: Verify build**

Run: `cd /home/mithrandir/agentistics && bun tsc --noEmit`
Expected: clean.

Run: `cd /home/mithrandir/agentistics && bun test`
Expected: all green.

Run: `cd /home/mithrandir/agentistics && bun run build`
Expected: Vite build succeeds (frontend typechecks + bundles).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/ChangePassword.tsx packages/web/src/App.tsx
git commit -m "feat(iam): blocking first-login change-password screen"
```

---

### Task 4: Create-account drawer — with-machine + random password + must-change

**Files:**
- Modify: `packages/web/src/pages/settings/UsersSettings.tsx`

**Interfaces:**
- Consumes: `generatePassword` (Task 1); `POST /api/iam/accounts` → body may include `machine?: { name: string }`, `mustChangePassword?: boolean`; response 201 `{ account: PublicAccount, machineToken?: string }` (`machineToken` present iff `machine.name` was sent).
- Produces: an extended create-account drawer. On success **with a machine**, renders a one-time result panel (credentials + machine token + connect command) instead of closing immediately.

**Design note:** the create form gains, inside the drawer: (1) a **"Provision a machine"** toggle → reveals a **machine name** input; (2) a **"Generate random password"** button that fills the password field and reveals it; (3) a **"Require password change on first login"** checkbox, default **on**. On submit, POST includes `machine` (when toggled) + `mustChangePassword`. When the response carries a `machineToken` (or when a random password was used), show the shown-once result panel with a copy button; only then does "Done" close the drawer.

- [ ] **Step 1: Add imports + local state**

At the top of `packages/web/src/pages/settings/UsersSettings.tsx`, extend the lucide import (line 3) and add the helper import:

```ts
import { Plus, Trash2, Copy, Check, Dice5 } from 'lucide-react'
import { generatePassword } from '../../lib/password'
```

(Task 5 adds `KeyRound` and `Pencil` to this import when they are first used — do not add them here or `tsc` will flag unused imports.)

Inside `UsersSettings()`, alongside the existing account-drawer state (after line 93 `const [accountErr, setAccountErr] = useState<string | null>(null)`), add:

```ts
  const [provisionMachine, setProvisionMachine] = useState(false)
  const [machineName, setMachineName] = useState('')
  const [mustChange, setMustChange] = useState(true)
  const [pwVisible, setPwVisible] = useState(false)
  // one-time result after a successful create (credentials + machine token shown once)
  const [created, setCreated] = useState<null | { name: string; email: string; password: string; mustChange: boolean; machineName?: string; machineToken?: string }>(null)
  const [copied, setCopied] = useState<string | null>(null)
```

- [ ] **Step 2: Reset the new fields when opening the drawer**

Extend `openAccountDrawer` (lines 95-98) to also reset the new state and clear any prior result:

```ts
  function openAccountDrawer() {
    setAn(''); setAe(''); setAp(''); setAccountType('member'); setRows([{ teamId: '', role: 'user' }]); setAccountErr(null)
    setProvisionMachine(false); setMachineName(''); setMustChange(true); setPwVisible(false); setCreated(null); setCopied(null)
    setAccountOpen(true)
  }
```

- [ ] **Step 3: Add a copy helper**

Add near the other handlers inside `UsersSettings()`:

```ts
  async function copy(label: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(c => c === label ? null : c), 1500) } catch { /* ignore */ }
  }
```

- [ ] **Step 4: Rewrite `createAccount` to send machine + mustChange and capture the result**

Replace the whole `createAccount` function (lines 105-124) with:

```ts
  async function createAccount() {
    if (!an.trim() || !ae.trim() || ap.length < 8) {
      setAccountErr(pt ? 'Preencha nome, email e senha (8+).' : 'Fill name, email and password (8+).')
      return
    }
    let memberships: Membership[] = []
    if (accountType === 'member') {
      memberships = rows.filter(r => r.teamId)
      if (memberships.length === 0) {
        setAccountErr(pt ? 'Selecione ao menos um time.' : 'Select at least one team.')
        return
      }
    }
    if (provisionMachine && !machineName.trim()) {
      setAccountErr(pt ? 'Informe o nome da máquina.' : 'Enter the machine name.')
      return
    }
    const body: Record<string, unknown> = {
      name: an.trim(), email: ae.trim(), password: ap, role: accountType, memberships,
      mustChangePassword: mustChange,
    }
    if (provisionMachine) body.machine = { name: machineName.trim() }
    const res = await fetch('/api/iam/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { const d = await res.json() as { error?: string }; setAccountErr(d.error || `HTTP ${res.status}`); return }
    const d = await res.json() as { machineToken?: string }
    setCreated({
      name: an.trim(), email: ae.trim(), password: ap, mustChange,
      machineName: provisionMachine ? machineName.trim() : undefined,
      machineToken: d.machineToken,
    })
    void load()
  }
```

- [ ] **Step 5: Add the "generate password", "provision machine", and "must-change" controls to the drawer body**

In the drawer, **replace** the existing password `Field` block (lines 249-251):

```tsx
        <Field label={pt ? 'Senha (8+)' : 'Password (8+)'}>
          <input style={input} type="password" value={ap} onChange={e => setAp(e.target.value)} placeholder="••••••••" />
        </Field>
```

with a password field that has a generate button + reveal toggle, followed by the must-change checkbox and the provision-machine block:

```tsx
        <Field label={pt ? 'Senha (8+)' : 'Password (8+)'}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input style={{ ...input, flex: 1 }} type={pwVisible ? 'text' : 'password'} value={ap}
              onChange={e => setAp(e.target.value)} placeholder="••••••••" />
            <button type="button" style={ghostBtn} title={pt ? 'Gerar senha aleatória' : 'Generate random password'}
              onClick={() => { const p = generatePassword(16); setAp(p); setPwVisible(true) }}>
              <Dice5 size={13} /> {pt ? 'Gerar' : 'Generate'}
            </button>
          </div>
        </Field>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={mustChange} onChange={e => setMustChange(e.target.checked)} />
          {pt ? 'Exigir troca de senha no primeiro login' : 'Require password change on first login'}
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={provisionMachine} onChange={e => setProvisionMachine(e.target.checked)} />
            {pt ? 'Provisionar uma máquina para esta conta' : 'Provision a machine for this account'}
          </label>
          {provisionMachine && (
            <Field label={pt ? 'Nome da máquina' : 'Machine name'}>
              <input style={input} value={machineName} onChange={e => setMachineName(e.target.value)} placeholder={pt ? 'ex.: laptop-trabalho' : 'e.g. work-laptop'} />
            </Field>
          )}
        </div>
```

- [ ] **Step 6: Show the shown-once result panel + gate the footer buttons on `created`**

**Replace** the drawer footer (lines 290-293):

```tsx
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button style={ghostBtn} onClick={() => setAccountOpen(false)}>{pt ? 'Cancelar' : 'Cancel'}</button>
          <button style={primaryBtn} onClick={() => void createAccount()}><Plus size={14} /> {pt ? 'Criar conta' : 'Create account'}</button>
        </div>
```

with a conditional: when `created` is set, render the credentials/token panel + a single "Done" button; otherwise the create/cancel buttons:

```tsx
        {created ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
              {pt ? 'Conta criada — copie os dados agora' : 'Account created — copy these now'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {pt ? 'Estes valores não serão exibidos novamente.' : 'These values will not be shown again.'}
            </div>
            {([
              ['Email', created.email],
              [pt ? 'Senha' : 'Password', created.password],
              ...(created.machineName ? [[pt ? 'Máquina' : 'Machine', created.machineName] as [string, string]] : []),
              ...(created.machineToken ? [[pt ? 'Token da máquina' : 'Machine token', created.machineToken] as [string, string]] : []),
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <code style={{ flex: 1, fontSize: 11.5, fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', wordBreak: 'break-all', color: 'var(--text-primary)' }}>{value}</code>
                  <button type="button" style={ghostBtn} onClick={() => void copy(label, value)} aria-label={`Copy ${label}`}>
                    {copied === label ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
            ))}
            {created.machineToken && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{pt ? 'Comando de conexão' : 'Connect command'}</span>
                <code style={{ fontSize: 11.5, fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', wordBreak: 'break-all', color: 'var(--text-secondary)' }}>
                  agentop member connect --endpoint &lt;central-url&gt; --token {created.machineToken}
                </code>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button style={primaryBtn} onClick={() => setAccountOpen(false)}><Check size={14} /> {pt ? 'Concluir' : 'Done'}</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button style={ghostBtn} onClick={() => setAccountOpen(false)}>{pt ? 'Cancelar' : 'Cancel'}</button>
            <button style={primaryBtn} onClick={() => void createAccount()}><Plus size={14} /> {pt ? 'Criar conta' : 'Create account'}</button>
          </div>
        )}
```

- [ ] **Step 7: Hide the form body once `created` is set (optional cleanliness)**

Wrap the drawer's form fields (the account-type block through the provision-machine block, i.e. everything between `{drawerErr(accountErr)}` and the footer conditional) so they only render when `!created`. The simplest approach: change the opening of that region from `{drawerErr(accountErr)}` to keep the error, then guard the rest with `{!created && (<>...</>)}`. Concretely, insert `{!created && (<>` immediately after the `{drawerErr(accountErr)}` line and `</>)}` immediately before the footer conditional added in Step 6. Verify JSX still balances.

- [ ] **Step 8: Verify build**

Run: `cd /home/mithrandir/agentistics && bun tsc --noEmit`
Expected: clean.

Run: `cd /home/mithrandir/agentistics && bun test`
Expected: all green.

Run: `cd /home/mithrandir/agentistics && bun run build`
Expected: Vite build succeeds.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/pages/settings/UsersSettings.tsx
git commit -m "feat(iam): create account with optional machine + random password + must-change"
```

---

### Task 5: Edit-account drawer — rename / memberships / reset password (PATCH)

**Files:**
- Modify: `packages/web/src/pages/settings/UsersSettings.tsx`

**Interfaces:**
- Consumes: `PATCH /api/iam/accounts` → body `{ id: string, name?: string, memberships?: { teamId: string; role: 'manager'|'user' }[], resetPassword?: true }`; response 200 `{ ok: true, account: PublicAccount, tempPassword?: string }` (`tempPassword` present iff `resetPassword` was `true`). Authz is server-side: owner edits any non-owner (rename-only on self-owner), manager edits only user-role accounts in managed teams.
- Produces: a per-row **Edit** action opening a drawer that PATCHes the account; a reset-password action that shows the returned `tempPassword` once.

**Design note:** reuse the shared `copy`/`copied` state and `Drawer` from Task 4. Owner accounts (`role === 'owner'`) can be renamed but have no memberships editor (owners have no team scope). The edit drawer reuses the memberships-rows editor pattern from create.

- [ ] **Step 1: Add edit-drawer state**

Inside `UsersSettings()`, after the create-drawer state, add:

```ts
  // ── edit drawer ──
  const [editOpen, setEditOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editIsOwner, setEditIsOwner] = useState(false)
  const [en, setEn] = useState('')
  const [eRows, setERows] = useState<Membership[]>([{ teamId: '', role: 'user' }])
  const [editErr, setEditErr] = useState<string | null>(null)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
```

- [ ] **Step 2: Add edit handlers**

Inside `UsersSettings()`, add:

```ts
  function openEditDrawer(a: Account) {
    setEditId(a.id); setEditIsOwner(a.role === 'owner'); setEn(a.name)
    setERows(a.memberships.length ? a.memberships.map(m => ({ ...m })) : [{ teamId: '', role: 'user' }])
    setEditErr(null); setTempPassword(null); setEditOpen(true)
  }
  function updateERow(i: number, patch: Partial<Membership>) { setERows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r)) }
  function addERow() { setERows(rs => [...rs, { teamId: '', role: 'user' }]) }
  function removeERow(i: number) { setERows(rs => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs) }

  async function saveEdit() {
    if (!editId) return
    if (!en.trim()) { setEditErr(pt ? 'O nome não pode ficar vazio.' : 'Name cannot be empty.'); return }
    const body: Record<string, unknown> = { id: editId, name: en.trim() }
    if (!editIsOwner) body.memberships = eRows.filter(r => r.teamId)
    const res = await fetch('/api/iam/accounts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { const d = await res.json() as { error?: string }; setEditErr(d.error || `HTTP ${res.status}`); return }
    setEditOpen(false); void load()
  }

  async function resetPassword() {
    if (!editId) return
    const res = await fetch('/api/iam/accounts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editId, resetPassword: true }),
    })
    if (!res.ok) { const d = await res.json() as { error?: string }; setEditErr(d.error || `HTTP ${res.status}`); return }
    const d = await res.json() as { tempPassword?: string }
    setTempPassword(d.tempPassword ?? null)
    void load()
  }
```

- [ ] **Step 3: Add an Edit button to each account row**

In the account table's action cell (lines 203-207), add an edit button before the delete button. Replace that `<td>`:

```tsx
                <td style={{ ...td, textAlign: 'right' }}>
                  {a.role !== 'owner' && (
                    <button onClick={() => void deleteAccount(a.id)} style={trashBtn} aria-label="Delete account"><Trash2 size={14} /></button>
                  )}
                </td>
```

with (owner may edit any account; a manager's edit is authorized server-side, so keep the button always visible and let the server 403 if not permitted — matches the "UI gating is advisory" constraint):

```tsx
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => openEditDrawer(a)} style={{ ...trashBtn, color: 'var(--text-tertiary)' }} aria-label="Edit account"><Pencil size={14} /></button>
                  {a.role !== 'owner' && (
                    <button onClick={() => void deleteAccount(a.id)} style={trashBtn} aria-label="Delete account"><Trash2 size={14} /></button>
                  )}
                </td>
```

Add `Pencil` to the lucide import (the Task 4 import line becomes):

```ts
import { Plus, Trash2, Copy, Check, Dice5, KeyRound, Pencil } from 'lucide-react'
```

- [ ] **Step 4: Render the edit drawer**

Immediately after the create `</Drawer>` (the closing tag around line 294, before the final `</div>`), add the edit drawer:

```tsx
      {/* Edit account drawer */}
      <Drawer open={editOpen} onClose={() => setEditOpen(false)} title={pt ? 'Editar conta' : 'Edit account'}>
        {drawerErr(editErr)}
        <Field label={pt ? 'Nome' : 'Name'}>
          <input style={input} value={en} onChange={e => setEn(e.target.value)} placeholder={pt ? 'Nome completo' : 'Full name'} />
        </Field>

        {editIsOwner ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '9px 11px' }}>
            {pt ? 'Owners não têm escopo de times.' : 'Owners have no team scope.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>{pt ? 'Escopo (times)' : 'Scope (teams)'}</span>
              <button type="button" style={ghostBtn} onClick={addERow}><Plus size={13} /> {pt ? 'Adicionar time' : 'Add team'}</button>
            </div>
            {eRows.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select style={{ ...input, flex: 2 }} value={r.teamId} onChange={e => updateERow(i, { teamId: e.target.value })}>
                  <option value="">{pt ? 'Selecione o time…' : 'Select team…'}</option>
                  {teams.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
                </select>
                <select style={{ ...input, flex: 1 }} value={r.role} onChange={e => updateERow(i, { role: e.target.value as 'manager' | 'user' })}>
                  <option value="user">user</option>
                  <option value="manager">manager</option>
                </select>
                <button type="button" onClick={() => removeERow(i)} disabled={eRows.length === 1}
                  style={{ ...trashBtn, opacity: eRows.length === 1 ? 0.35 : 1, cursor: eRows.length === 1 ? 'not-allowed' : 'pointer' }}
                  aria-label={pt ? 'Remover time' : 'Remove team'}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Reset password */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
          {tempPassword ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{pt ? 'Senha temporária (mostrada uma vez)' : 'Temporary password (shown once)'}</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <code style={{ flex: 1, fontSize: 11.5, fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', wordBreak: 'break-all', color: 'var(--text-primary)' }}>{tempPassword}</code>
                <button type="button" style={ghostBtn} onClick={() => void copy('temp', tempPassword)} aria-label="Copy temp password">
                  {copied === 'temp' ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{pt ? 'O usuário deverá trocá-la no próximo login.' : 'The user must change it on next login.'}</span>
            </div>
          ) : (
            <button type="button" style={ghostBtn} onClick={() => void resetPassword()}>
              <KeyRound size={13} /> {pt ? 'Resetar senha (gera temporária)' : 'Reset password (generates temp)'}
            </button>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button style={ghostBtn} onClick={() => setEditOpen(false)}>{pt ? 'Fechar' : 'Close'}</button>
          <button style={primaryBtn} onClick={() => void saveEdit()}><Check size={14} /> {pt ? 'Salvar' : 'Save'}</button>
        </div>
      </Drawer>
```

- [ ] **Step 5: Verify build**

Run: `cd /home/mithrandir/agentistics && bun tsc --noEmit`
Expected: clean.

Run: `cd /home/mithrandir/agentistics && bun test`
Expected: all green.

Run: `cd /home/mithrandir/agentistics && bun run build`
Expected: Vite build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/pages/settings/UsersSettings.tsx
git commit -m "feat(iam): edit account drawer (rename/memberships/reset password)"
```

---

## Manual integration check (controller-run, after Task 5)

Rebuild the central, hard-reload (or incognito — PWA SW caveat), sign in as owner:
1. **Create with machine + random pw:** Users → New account → fill name/email, click **Generate**, toggle **Provision a machine**, name it `laptop-1`, keep **require change** on, Create → result panel shows email/password/machine token + connect command; copy buttons work; Done closes.
2. **First-login change:** in a separate browser/incognito, sign in with the new account's email + shown password → the **Set a new password** screen blocks the app; set an 8+ password → app opens; re-login is not prompted for change again.
3. **Edit memberships:** Users → Edit a member → change a team/role → Save → table reflects new teams.
4. **Reset password:** Edit → Reset password → temp password shown once → sign in as that user → forced change screen appears.
5. **Authz:** as a manager (non-owner), confirm editing a user in a team you don't manage returns the server 403 surfaced in the drawer (advisory UI, server-enforced).

## Self-Review

- **Spec §5 Central "Create account" (two modes + generate random + require-change + machine token once):** Task 4. ✅
- **Spec §5 Central "Edit account" (name, memberships, reset password) drawer:** Task 5. ✅
- **Spec §5 Central "First-login password change" (blocking):** Tasks 2+3. ✅
- **Spec §5 "Machines page = view" / Machine client Central connection:** **Out of scope** — Phase 3 (machines grouped view) and Phase 4 (machine identity), per roadmap phasing. Not in this plan.
- **Placeholder scan:** every code step contains full code; no TBD/TODO. ✅
- **Type consistency:** `Membership`/`Account`/`Team` reuse the file's existing local types; `mustChangePassword: boolean` added consistently to `Principal` (app-context) + `IamAccount` (App.tsx); `generatePassword(length?)` signature matches its use in Task 4; `copy`/`copied` shared between Tasks 4 & 5 (defined in Task 4 — Task 5 depends on Task 4 being applied first, which the sequential order guarantees). ✅
- **TDD:** only `generatePassword` is a pure unit (Task 1, real red→green). React components follow repo convention (no component unit tests; verified via `tsc` + `bun run build` + manual) — consistent with the "test pure functions only" rule in CLAUDE.md. ✅
