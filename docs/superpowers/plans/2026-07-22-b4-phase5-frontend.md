# B4 Phase 5 — Frontend + gate flip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make IAM usable in the browser and switch the central to account auth: OwnerSetup + email/password Login screens, logged-in user + role display + logout in the sidebar, an IAM tab (Teams + Accounts management), and the **server gate flip** — non-public `/api/*` on a central now requires a valid account principal; ADMIN + IAM-write routes require the owner; the shared-password login is disabled.

**Architecture:** Frontend fetches `/api/iam/status` + `/api/iam/me` and gates OwnerSetup / Login / app (central only; member/solo unchanged). New `Login.tsx`, `OwnerSetup.tsx`, `IamTab.tsx` modeled on `TeamLogin.tsx`'s raw-`fetch` + CSS-var styling. `SideNav` shows the account. The server gate in `index.ts` swaps `isAuthed` (shared password) for `getPrincipal` (account session), with the IAM public routes + `/api/health` kept ungated so the bootstrap/login UI always loads (anti-lockout).

**Tech Stack:** React + Vite (web), Bun + TS (server).

## Global Constraints

- English; TS strict, no `any`. Commit subjects lowercase.
- **Anti-lockout (critical):** `/api/iam/status`, `/api/iam/bootstrap`, `/api/iam/login`, `/api/iam/me`, `/api/iam/logout`, and `/api/health` MUST stay in `AUTH_PUBLIC`. Static assets stay ungated (gate only matches `/api/`). The flip is `TEAM_CENTRAL`-only — member/solo machines are never gated.
- Frontend uses raw same-origin `fetch` (cookies auto-sent); match the house style: `if (!res.ok) throw new Error(...)`, typed `res.json()`.
- UI components are not unit-tested (no component test infra; tests are for pure fns) — verified by the end-to-end rebuild at the end.
- Run `bun tsc --noEmit` after each task; `bun test` stays green.

---

### Task 1: `Login.tsx` — email/password login screen

**Files:** Create `packages/web/src/components/Login.tsx`

**Interfaces:** Produces `export function Login({ onAuthed }: { onAuthed: () => void })`.

- [ ] **Step 1: Write the component** (model the layout on `TeamLogin.tsx`)

```tsx
// packages/web/src/components/Login.tsx
import React, { useState, useRef, useEffect } from 'react'
import { AlertCircle, LogIn } from 'lucide-react'

/** Central account login (email + password). Posts /api/iam/login; the server sets the session cookie. */
export function Login({ onAuthed }: { onAuthed: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<'wrong' | 'network' | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password || submitting) return
    setSubmitting(true); setError(null)
    try {
      const res = await fetch('/api/iam/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const data = (await res.json()) as { ok: boolean }
      if (res.ok && data.ok) onAuthed()
      else setError('wrong')
    } catch { setError('network') } finally { setSubmitting(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', padding: 16 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 360, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 28, boxShadow: '0 12px 40px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <span style={{ display: 'inline-flex', padding: 9, borderRadius: 10, background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)' }}><LogIn size={18} /></span>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>agentistics</span>
        </div>
        <Field label="Email" type="email" value={email} onChange={setEmail} inputRef={ref} disabled={submitting} />
        <Field label="Password" type="password" value={password} onChange={setPassword} disabled={submitting} />
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#ef4444', marginBottom: 12 }}>
            <AlertCircle size={13} /> {error === 'wrong' ? 'Invalid email or password.' : 'Network error — try again.'}
          </div>
        )}
        <button type="submit" disabled={!email.trim() || !password || submitting}
          style={{ width: '100%', padding: '9px 14px', borderRadius: 8, border: '1px solid var(--anthropic-orange)', background: (!email.trim() || !password || submitting) ? 'var(--bg-elevated)' : 'var(--anthropic-orange-dim)', color: (!email.trim() || !password || submitting) ? 'var(--text-tertiary)' : 'var(--anthropic-orange)', fontSize: 13, fontWeight: 600, cursor: (!email.trim() || !password || submitting) ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

/** Shared labelled input used by Login + OwnerSetup. */
export function Field({ label, type, value, onChange, inputRef, disabled }: {
  label: string; type: string; value: string; onChange: (v: string) => void
  inputRef?: React.RefObject<HTMLInputElement | null>; disabled?: boolean
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 5 }}>{label}</div>
      <input ref={inputRef} type={type} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 11px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit' }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--anthropic-orange)' }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }} />
    </div>
  )
}
```

- [ ] **Step 2: Type-check.** `bun tsc --noEmit` — no errors.
- [ ] **Step 3: Commit.** `git add packages/web/src/components/Login.tsx && git commit -m "feat(iam): email/password login screen"`

---

### Task 2: `OwnerSetup.tsx` — first-owner setup screen

**Files:** Create `packages/web/src/components/OwnerSetup.tsx`

**Interfaces:** Produces `export function OwnerSetup({ onDone }: { onDone: () => void })`.

- [ ] **Step 1: Write the component** (reuses `Field` from `Login.tsx`)

```tsx
// packages/web/src/components/OwnerSetup.tsx
import React, { useState } from 'react'
import { AlertCircle, ShieldCheck } from 'lucide-react'
import { Field } from './Login'

/** First-boot owner creation. Requires the one-time setup token printed to the central's logs.
 *  Posts /api/iam/bootstrap; on success the server sets the session cookie and the app opens. */
export function OwnerSetup({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setSubmitting(true); setError(null)
    try {
      const res = await fetch('/api/iam/bootstrap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), name: name.trim(), email: email.trim(), password, confirm }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (res.ok && data.ok) onDone()
      else setError(data.error || 'Setup failed.')
    } catch { setError('Network error — try again.') } finally { setSubmitting(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', padding: 16 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 400, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 28, boxShadow: '0 12px 40px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ display: 'inline-flex', padding: 9, borderRadius: 10, background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)' }}><ShieldCheck size={18} /></span>
          <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>Create owner account</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5, margin: '0 0 18px' }}>
          First-time setup. Paste the one-time setup token from the central's logs, then create the owner account.
        </p>
        <Field label="Setup token" type="text" value={token} onChange={setToken} disabled={submitting} />
        <Field label="Name" type="text" value={name} onChange={setName} disabled={submitting} />
        <Field label="Email" type="email" value={email} onChange={setEmail} disabled={submitting} />
        <Field label="Password" type="password" value={password} onChange={setPassword} disabled={submitting} />
        <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} disabled={submitting} />
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#ef4444', marginBottom: 12 }}>
            <AlertCircle size={13} /> {error}
          </div>
        )}
        <button type="submit" disabled={submitting || !token.trim() || !name.trim() || !email.trim() || password.length < 8 || password !== confirm}
          style={{ width: '100%', padding: '9px 14px', borderRadius: 8, border: '1px solid var(--anthropic-orange)', background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: (submitting || !token.trim() || !name.trim() || !email.trim() || password.length < 8 || password !== confirm) ? 0.6 : 1 }}>
          {submitting ? 'Creating…' : 'Create owner & sign in'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Type-check.** `bun tsc --noEmit` — no errors.
- [ ] **Step 3: Commit.** `git add packages/web/src/components/OwnerSetup.tsx && git commit -m "feat(iam): first-owner setup screen"`

---

### Task 3: App.tsx gate — fetch IAM status/me and route OwnerSetup/Login/app

**Files:** Modify `packages/web/src/App.tsx`

**Interfaces:** Produces (in-module) `iam` state `{ needsBootstrap: boolean; authed: boolean; account?: IamAccount }` + `reloadIam()`; threads `account` to `SideNav` (Task 4).

- [ ] **Step 1: Add the IAM account type + state + fetch.** Near the `TeamSessionState` type (~:56), add:
```ts
export interface IamAccount { id: string; name: string; email: string; role: 'owner' | 'member'; memberships: { teamId: string; role: 'manager' | 'user' }[] }
interface IamState { needsBootstrap: boolean; authed: boolean; account?: IamAccount }
```
In `AppLayout` near the `teamSession` state (~:995) add:
```ts
const [iam, setIam] = useState<IamState | undefined>(undefined)
const reloadIam = useCallback(() => {
  Promise.all([
    fetch('/api/iam/status').then(r => r.ok ? r.json() : { needsBootstrap: false }),
    fetch('/api/iam/me').then(r => r.ok ? r.json() : { authed: false }),
  ]).then(([st, me]) => setIam({ needsBootstrap: !!st.needsBootstrap, authed: !!me.authed, account: me.account }))
    .catch(() => setIam({ needsBootstrap: false, authed: false }))
}, [])
useEffect(() => { if (teamSession?.central) reloadIam() }, [teamSession?.central, reloadIam])
```

- [ ] **Step 2: Replace the gate block** (~:1648-1657). First READ the current block. Replace with:
```tsx
if (teamSession === undefined) {
  return <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }} />
}
// Central: account-based IAM gate (bootstrap → login → app).
if (teamSession.central) {
  if (iam === undefined) return <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }} />
  if (iam.needsBootstrap) return <OwnerSetup onDone={() => { reloadIam(); refetch() }} />
  if (!iam.authed) return <Login onAuthed={() => { reloadIam(); refetch() }} />
} else if (teamSession.required && !teamSession.authed) {
  // Non-central (member/solo) keeps the legacy password gate.
  return <TeamLogin onAuthed={() => { setTeamSession(s => ({ ...(s ?? { required: true }), required: true, authed: true })); refetch() }} />
}
```
Add the imports at the top of App.tsx: `import { Login } from './components/Login'` and `import { OwnerSetup } from './components/OwnerSetup'`.

- [ ] **Step 3: Also re-gate on 401 for central.** In the existing 401-watch effect (~:1014-1018), when `teamSession?.central` and the data error includes `'401'`, call `reloadIam()` (so an expired/rotated account session drops back to Login). Add alongside the existing logic:
```ts
if (teamSession?.central && String(error).includes('401')) reloadIam()
```

- [ ] **Step 4: Thread the account to SideNav.** At the `SideNav` render site (~:1753-1780), pass `principal={iam?.account}` (consumed in Task 4).

- [ ] **Step 5: Type-check.** `bun tsc --noEmit` — no errors. `bun test` green.
- [ ] **Step 6: Commit.** `git add packages/web/src/App.tsx && git commit -m "feat(iam): central gate routes owner-setup / login / app"`

---

### Task 4: SideNav — logged-in account display + logout

**Files:** Modify `packages/web/src/App.tsx` (the `SideNav` component)

- [ ] **Step 1: Add a `principal` prop.** Extend the `SideNav` signature (~:847) with `principal`:
```ts
principal?: { name: string; role: 'owner' | 'member'; memberships: { teamId: string; role: 'manager' | 'user' }[] }
```

- [ ] **Step 2: Render name + role + logout in the SideNav footer** (~:946-979, the config-controls row). Add, before/after the existing buttons:
```tsx
{principal && (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', minWidth: 0 }}>
    <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', flexShrink: 0 }}>{principal.name.slice(0, 2)}</div>
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{principal.name}</div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{principal.role === 'owner' ? 'Owner' : (principal.memberships.some(m => m.role === 'manager') ? 'Manager' : 'User')}</div>
    </div>
    <button title="Log out" onClick={() => { void fetch('/api/iam/logout', { method: 'POST' }).then(() => window.location.reload()) }}
      style={{ display: 'inline-flex', padding: 6, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', flexShrink: 0 }}>
      <LogOut size={14} />
    </button>
  </div>
)}
```
Add `LogOut` to the existing lucide-react import in App.tsx.

- [ ] **Step 3: Type-check.** `bun tsc --noEmit` — no errors.
- [ ] **Step 4: Commit.** `git add packages/web/src/App.tsx && git commit -m "feat(iam): sidebar shows logged-in account + logout"`

---

### Task 5: IAM tab (Teams + Accounts management)

**Files:**
- Create `packages/web/src/components/IamTab.tsx`
- Modify `packages/web/src/components/PreferencesModal.tsx`

- [ ] **Step 1: Write `IamTab.tsx`** — lists/creates/deletes teams and accounts.

```tsx
// packages/web/src/components/IamTab.tsx
import React, { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2, Users, Shield } from 'lucide-react'

interface Team { _id: string; name: string }
interface Membership { teamId: string; role: 'manager' | 'user' }
interface Account { id: string; name: string; email: string; role: 'owner' | 'member'; memberships: Membership[] }

export function IamTab({ pt }: { pt: boolean }) {
  const [teams, setTeams] = useState<Team[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([
        fetch('/api/iam/teams').then(r => r.json() as Promise<{ teams: Team[] }>),
        fetch('/api/iam/accounts').then(r => r.json() as Promise<{ accounts: Account[] }>),
      ])
      setTeams(t.teams ?? []); setAccounts(a.accounts ?? [])
    } catch (e) { setErr(String(e)) }
  }, [])
  useEffect(() => { void load() }, [load])

  // team create/delete
  const [teamName, setTeamName] = useState('')
  async function createTeam() {
    if (!teamName.trim()) return
    await fetch('/api/iam/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: teamName.trim() }) })
    setTeamName(''); void load()
  }
  async function deleteTeam(id: string) {
    await fetch('/api/iam/teams', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    void load()
  }

  // account create/delete
  const [an, setAn] = useState(''); const [ae, setAe] = useState(''); const [ap, setAp] = useState('')
  const [atTeam, setAtTeam] = useState(''); const [atRole, setAtRole] = useState<'manager' | 'user'>('user')
  async function createAccount() {
    if (!an.trim() || !ae.trim() || ap.length < 8 || !atTeam) return
    const res = await fetch('/api/iam/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: an.trim(), email: ae.trim(), password: ap, memberships: [{ teamId: atTeam, role: atRole }] }) })
    if (!res.ok) { const d = await res.json() as { error?: string }; setErr(d.error || `HTTP ${res.status}`); return }
    setAn(''); setAe(''); setAp(''); setErr(null); void load()
  }
  async function deleteAccount(id: string) {
    await fetch('/api/iam/accounts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    void load()
  }

  const teamName_ = (id: string) => teams.find(t => t._id === id)?.name ?? id
  const box: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 16 }
  const input: React.CSSProperties = { padding: '6px 9px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, color: 'var(--text-primary)', fontFamily: 'inherit', outline: 'none' }
  const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--anthropic-orange)', background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }

  return (
    <div>
      {err && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{err}</div>}

      {/* Teams */}
      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}><Users size={14} /> {pt ? 'Times' : 'Teams'}</div>
        {teams.map(t => (
          <div key={t._id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--border-subtle)' }}>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)' }}>{t.name} {t._id === 'default' && <em style={{ color: 'var(--text-tertiary)' }}>(default)</em>}</span>
            {t._id !== 'default' && <button onClick={() => void deleteTeam(t._id)} style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={13} /></button>}
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <input style={{ ...input, flex: 1 }} placeholder={pt ? 'Nome do time' : 'Team name'} value={teamName} onChange={e => setTeamName(e.target.value)} />
          <button style={btn} onClick={() => void createTeam()}><Plus size={13} /> {pt ? 'Criar' : 'Create'}</button>
        </div>
      </div>

      {/* Accounts */}
      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}><Shield size={14} /> {pt ? 'Contas' : 'Accounts'}</div>
        {accounts.map(a => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--border-subtle)' }}>
            <span style={{ flex: 1, fontSize: 12, color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.name} · {a.email} · <strong>{a.role === 'owner' ? 'owner' : a.memberships.map(m => `${m.role}@${teamName_(m.teamId)}`).join(', ')}</strong>
            </span>
            {a.role !== 'owner' && <button onClick={() => void deleteAccount(a.id)} style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer' }}><Trash2 size={13} /></button>}
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
          <input style={input} placeholder={pt ? 'Nome' : 'Name'} value={an} onChange={e => setAn(e.target.value)} />
          <input style={input} placeholder="Email" value={ae} onChange={e => setAe(e.target.value)} />
          <input style={input} type="password" placeholder={pt ? 'Senha (8+)' : 'Password (8+)'} value={ap} onChange={e => setAp(e.target.value)} />
          <select style={input} value={atTeam} onChange={e => setAtTeam(e.target.value)}>
            <option value="">{pt ? 'Time…' : 'Team…'}</option>
            {teams.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
          </select>
          <select style={input} value={atRole} onChange={e => setAtRole(e.target.value as 'manager' | 'user')}>
            <option value="user">user</option>
            <option value="manager">manager</option>
          </select>
          <button style={btn} onClick={() => void createAccount()}><Plus size={13} /> {pt ? 'Criar conta' : 'Create account'}</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the tab in `PreferencesModal.tsx`.** First READ the tab wiring. (a) add `| 'iam'` to the `SettingsTab` union (~:60); (b) add a TABS entry (import a `Shield` icon from lucide-react): `{ id: 'iam', icon: <Shield size={13} />, labelEn: 'IAM', labelPt: 'IAM' }`; (c) in `visibleTabs` (~:1185), keep `iam` only when central — mirror the `repositories` central-only filter so a non-central view drops `'iam'`; (d) in the active-tab bounce effect (~:1186-1189) add `iam` to the set that reverts to `preferences` when hidden; (e) in the body (~:1298-1299) add `{activeTab === 'iam' && <IamTab pt={pt} />}` and `import { IamTab } from './IamTab'`.

- [ ] **Step 3: Type-check.** `bun tsc --noEmit` — no errors. `bun test` green.
- [ ] **Step 4: Commit.** `git add packages/web/src/components/IamTab.tsx packages/web/src/components/PreferencesModal.tsx && git commit -m "feat(iam): iam settings tab (teams + accounts)"`

---

### Task 6: Server gate flip — require account principal on the central

**Files:** Modify `packages/server/server/index.ts`

- [ ] **Step 1: Keep the anti-lockout routes public.** In `AUTH_PUBLIC` (~:152-171) ensure `/api/health` is present (add it if missing). Confirm all `/api/iam/*` routes are present (they are, from Phases 2-3).

- [ ] **Step 2: Flip the dashboard gate** (~:224-235). First READ it. Replace the `TEAM_PASSWORD && ... !isAuthed(req)` condition with a principal requirement, computing the principal once:
```ts
    // Account-auth gate (central): any non-public /api route needs a valid account session.
    if (TEAM_CENTRAL && url.pathname.startsWith('/api/') && !AUTH_PUBLIC.has(url.pathname)) {
      const principal = await getPrincipal(req)
      if (!principal) {
        return new Response(JSON.stringify({ error: 'auth required' }), { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }
      // Admin + IAM-write routes require the owner.
      const isIamWrite = (url.pathname === '/api/iam/teams' || url.pathname === '/api/iam/accounts') && req.method !== 'GET'
      if ((ADMIN_PATHS.has(url.pathname) || isIamWrite) && principal.role !== 'owner') {
        return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }
    }
```
> Note: `/api/iam/teams` and `/api/iam/accounts` are in AUTH_PUBLIC (self-guarding) so the block above won't run for them via the `!AUTH_PUBLIC.has` guard — the owner check for IAM writes therefore stays enforced INSIDE the handlers (Phase 3 already does: teams POST/DELETE are owner-only; accounts use canCreate/canDelete). So you may DROP the `isIamWrite` clause here to avoid dead code — keep only the `!principal → 401` + `ADMIN_PATHS → owner` checks. Verify against Phase 3's handler guards and keep a single source of truth.

- [ ] **Step 3: Replace the old admin gate** (~:237-240, the `hasValidSession` block). The ADMIN_PATHS owner-check now lives in Step 2's block, so REMOVE the separate `hasValidSession` admin gate (it enforced the shared-password cookie, which is being retired). Confirm ADMIN_PATHS routes are NOT in AUTH_PUBLIC (so Step 2's gate covers them).

- [ ] **Step 4: Disable the shared-password login.** At the `/api/team/login` dispatch (~:901-906) return 410 Gone (login moved to accounts) instead of calling `handleLogin`:
```ts
if (url.pathname === '/api/team/login' && req.method === 'POST') {
  return new Response(JSON.stringify({ ok: false, error: 'shared-password login retired; use account login' }), { status: 410, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}
```
Leave `/api/team/logout` and `/api/team/session` intact (still used for the `central` flag until fully migrated).

- [ ] **Step 5: Type-check + suite.** `bun tsc --noEmit` — no errors. `bun test` — all pass.
- [ ] **Step 6: Commit.** `git add packages/server/server/index.ts && git commit -m "feat(iam): flip central gate to account auth, retire shared-password login"`

---

## Self-Review

**Spec coverage (Phase 5 slice):** OwnerSetup + Login screens (spec §6, §8) → Tasks 1-3; logged-in user + role display + logout (spec §3, §8) → Task 4; IAM tab managing teams + accounts (spec §8) → Task 5; the gate flip + shared-password removal + owner-gated admin (spec §5.5, §8) → Task 6. Data scoping (Phase 4) now takes effect for real once non-owner accounts log in.

**Deferred:** account/team editing (PATCH), member-panel team scoping, migrating `/api/team/session` consumers to `/api/iam/*` then retiring `handleSession` — polish, not needed for the E2E test.

**Placeholder scan:** none — full component + gate code; every "READ first" points at a real, inspectable seam.

**Type consistency:** `IamAccount` (App.tsx) mirrors `PublicAccount` from the server (`id/name/email/role/memberships`). `Field` exported from `Login.tsx` reused by `OwnerSetup.tsx`. IamTab's `Team/Account/Membership` shapes match the server responses (`{teams}`, `{accounts}`).

**Anti-lockout:** IAM public routes + `/api/health` stay in AUTH_PUBLIC; flip is central-only; static assets ungated; the `needsBootstrap` path is reachable with no account. If the owner session is lost, `/api/iam/login` remains public to sign back in; if all accounts are lost, `needsBootstrap` re-opens OwnerSetup (a new token prints on boot).
