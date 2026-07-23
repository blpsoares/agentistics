import React, { useEffect, useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Trash2, Copy, Check, Dice5, KeyRound, Pencil } from 'lucide-react'
import { generatePassword } from '../../lib/password'
import type { AppContext } from '../../lib/app-context'
import { SectionHeader } from './primitives'
import { Drawer } from './Drawer'

interface Team { _id: string; name: string }
interface Membership { teamId: string; role: 'manager' | 'user' }
interface Account { id: string; name: string; email: string; role: 'owner' | 'admin' | 'member'; memberships: Membership[] }

// ── shared inline styles ──────────────────────────────────────────────────
const input: React.CSSProperties = {
  padding: '9px 11px', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
  borderRadius: 7, fontSize: 13, color: 'var(--text-primary)', fontFamily: 'inherit',
  outline: 'none', width: '100%', boxSizing: 'border-box',
}
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 7, border: '1px solid var(--anthropic-orange)',
  background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)',
  fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}
const ghostBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 7,
  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
}
const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)',
  letterSpacing: '0.06em', textTransform: 'uppercase', padding: '0 10px 8px', whiteSpace: 'nowrap',
}
const td: React.CSSProperties = {
  fontSize: 12.5, color: 'var(--text-secondary)', padding: '9px 10px',
  borderTop: '1px solid var(--border-subtle)', verticalAlign: 'middle',
}
const trashBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer',
  display: 'inline-flex', padding: 4,
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </label>
  )
}

const ROLE_BADGE_COLORS: Record<string, string> = {
  owner: '#a855f7', admin: '#14b8a6', manager: 'var(--anthropic-orange)', user: '#3b82f6',
}
function RoleBadge({ role }: { role: string }) {
  const color = ROLE_BADGE_COLORS[role] ?? 'var(--text-tertiary)'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10.5,
      fontWeight: 700, color, background: `color-mix(in srgb, ${color} 16%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`, textTransform: 'capitalize',
    }}>
      {role}
    </span>
  )
}

// ── page ──────────────────────────────────────────────────────────────────
export default function UsersSettings() {
  const { lang, me } = useOutletContext<AppContext>()
  const pt = lang === 'pt'
  const viewerIsOwner = me?.role === 'owner'

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

  // ── account drawer ──
  const [accountOpen, setAccountOpen] = useState(false)
  const [an, setAn] = useState(''); const [ae, setAe] = useState(''); const [ap, setAp] = useState('')
  const [accountType, setAccountType] = useState<'owner' | 'admin' | 'member'>('member')
  const [rows, setRows] = useState<Membership[]>([{ teamId: '', role: 'user' }])
  const [accountErr, setAccountErr] = useState<string | null>(null)
  const [provisionMachine, setProvisionMachine] = useState(false)
  const [machineName, setMachineName] = useState('')
  const [mustChange, setMustChange] = useState(true)
  const [pwVisible, setPwVisible] = useState(false)
  // one-time result after a successful create (credentials + machine token shown once)
  const [created, setCreated] = useState<null | { email: string; password: string; machineName?: string; machineToken?: string }>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState<string | null>(null)

  // ── edit drawer ──
  const [editOpen, setEditOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editIsOwner, setEditIsOwner] = useState(false)
  const [en, setEn] = useState('')
  const [eRows, setERows] = useState<Membership[]>([{ teamId: '', role: 'user' }])
  const [editErr, setEditErr] = useState<string | null>(null)
  const [tempPassword, setTempPassword] = useState<string | null>(null)

  function openAccountDrawer() {
    setAn(''); setAe(''); setAp(''); setAccountType('member'); setRows([{ teamId: '', role: 'user' }]); setAccountErr(null)
    setProvisionMachine(false); setMachineName(''); setMustChange(true); setPwVisible(false); setCreated(null); setCopied(null); setCopyFailed(null)
    setAccountOpen(true)
  }
  async function copy(label: string, text: string) {
    setCopyFailed(null)
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(label)
        setTimeout(() => setCopied(c => c === label ? null : c), 1500)
        return
      } catch { /* fallback below */ }
    }
    // fallback: execCommand via temp textarea
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    try {
      const ok = document.execCommand('copy')
      if (ok) {
        setCopied(label)
        setTimeout(() => setCopied(c => c === label ? null : c), 1500)
      } else {
        setCopyFailed(label)
      }
    } catch {
      setCopyFailed(label)
    } finally {
      document.body.removeChild(ta)
    }
  }
  function updateRow(i: number, patch: Partial<Membership>) {
    setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }
  function addRow() { setRows(rs => [...rs, { teamId: '', role: 'user' }]) }
  function removeRow(i: number) { setRows(rs => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs) }

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
      email: ae.trim(), password: ap,
      machineName: provisionMachine ? machineName.trim() : undefined,
      machineToken: d.machineToken,
    })
    void load()
  }
  async function deleteAccount(id: string) {
    await fetch('/api/iam/accounts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    void load()
  }

  function openEditDrawer(a: Account) {
    setEditId(a.id); setEditIsOwner(a.role === 'owner' || a.role === 'admin'); setEn(a.name)
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

  const teamNameOf = (id: string) => teams.find(t => t._id === id)?.name ?? id

  // Ready-to-paste connect command using the endpoint the admin is actually viewing.
  const connectCmd = created?.machineToken
    ? `agentop member connect --endpoint ${window.location.origin} --token ${created.machineToken}`
    : ''

  const roleLegend = pt
    ? [['Owner', 'controle total'], ['Admin', 'gerencia tudo, menos owners/admins'], ['Manager', 'gerencia usuários e tokens do seu time'], ['User', 'leitura restrita']]
    : [['Owner', 'full control'], ['Admin', 'manages everything except owners/admins'], ['Manager', "manages their team's users & tokens"], ['User', 'scoped read']]

  const drawerErr = (m: string | null) => m && (
    <div style={{ fontSize: 12, color: '#ef4444', background: 'color-mix(in srgb, #ef4444 12%, transparent)', border: '1px solid color-mix(in srgb, #ef4444 35%, transparent)', borderRadius: 7, padding: '8px 10px' }}>{m}</div>
  )

  const ownerCount = accounts.filter(a => a.role === 'owner').length
  function canDeleteClient(a: Account): boolean {
    if (!me) return false
    if (a.id === me.id) return false                    // never yourself
    if (a.role === 'owner') return me.role === 'owner' && ownerCount > 1   // last-owner protected
    if (a.role === 'admin') return me.role === 'owner'
    // target is a member:
    if (me.role === 'owner' || me.role === 'admin') return true
    const managed = new Set(me.memberships.filter(m => m.role === 'manager').map(m => m.teamId))
    return a.memberships.length > 0 && a.memberships.every(m => m.role === 'user' && managed.has(m.teamId))
  }
  // Mirror the server PATCH authz: self (rename) always; owner edits anyone; else same rule as delete.
  function canEditClient(a: Account): boolean {
    if (!me) return false
    if (a.id === me.id) return true            // self rename
    if (me.role === 'owner') return true
    return canDeleteClient(a)                  // admin → members; manager → managed user-members
  }

  return (
    <div>
      <SectionHeader label={pt ? 'Usuários' : 'Users'} />

      <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' }}>
        {pt
          ? 'Contas que acessam o painel central. Cada usuário pertence a um ou mais times.'
          : 'Accounts that sign in to the central dashboard. Each user belongs to one or more teams.'}
      </p>

      {/* role legend */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'center',
        fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5,
        border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '10px 12px', marginBottom: 18,
      }}>
        {roleLegend.map(([role, desc], i) => (
          <React.Fragment key={role}>
            <span><strong style={{ color: 'var(--text-secondary)' }}>{role}</strong> — {desc}</span>
            {i < roleLegend.length - 1 && <span style={{ color: 'var(--border)' }}>·</span>}
          </React.Fragment>
        ))}
      </div>

      {err && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 12 }}>{err}</div>}

      {/* Accounts */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{pt ? 'Contas' : 'Accounts'}</div>
        <button style={primaryBtn} onClick={openAccountDrawer}><Plus size={14} /> {pt ? 'Nova conta' : 'New account'}</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>{pt ? 'Nome' : 'Name'}</th>
              <th style={th}>Email</th>
              <th style={th}>{pt ? 'Papel' : 'Role'}</th>
              <th style={th}>{pt ? 'Times' : 'Teams'}</th>
              <th style={{ ...th, width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 && (
              <tr><td style={{ ...td, color: 'var(--text-tertiary)' }} colSpan={5}>{pt ? 'Nenhuma conta.' : 'No accounts.'}</td></tr>
            )}
            {accounts.map(a => (
              <tr key={a.id}>
                <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 500 }}>{a.name}</td>
                <td style={td}>{a.email}</td>
                <td style={td}><RoleBadge role={a.role === 'owner' ? 'owner' : a.role === 'admin' ? 'admin' : (a.memberships[0]?.role ?? 'user')} /></td>
                <td style={td}>
                  <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
                    {(a.role === 'owner' || a.role === 'admin')
                      ? <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                      : a.memberships.map(m => (
                        <span key={m.teamId} style={{
                          display: 'inline-block', padding: '2px 7px', borderRadius: 6, fontSize: 10.5,
                          background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                        }}>{teamNameOf(m.teamId)}</span>
                      ))}
                  </span>
                </td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canEditClient(a) && (
                    <button onClick={() => openEditDrawer(a)} style={{ ...trashBtn, color: 'var(--text-tertiary)' }} aria-label="Edit account"><Pencil size={14} /></button>
                  )}
                  {canDeleteClient(a) && (
                    <button onClick={() => void deleteAccount(a.id)} style={trashBtn} aria-label="Delete account"><Trash2 size={14} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Account drawer — while showing shown-once secrets, only the explicit "Done" button closes it
          (backdrop/X are no-ops) so the machine token/command can't be lost to a stray click. */}
      <Drawer open={accountOpen} onClose={() => { if (!created) setAccountOpen(false) }} title={pt ? 'Nova conta' : 'New account'}>
        {drawerErr(accountErr)}

        {!created && (<>
        {/* Account type — Owner is offered only to an owner viewer. */}
        {viewerIsOwner && (
          <Field label={pt ? 'Tipo de conta' : 'Account type'}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {([
                ['member', pt ? 'Membro com escopo' : 'Scoped member', pt ? 'Acesso restrito a times' : 'Access scoped to teams'],
                ['admin', pt ? 'Admin' : 'Admin', pt ? 'Gerencia tudo, menos owners/admins' : 'Manages everything except owners/admins'],
                ['owner', pt ? 'Owner (acesso total)' : 'Owner (full access)', pt ? 'Controle total do painel' : 'Full dashboard control'],
              ] as const).map(([val, title, desc]) => {
                const selected = accountType === val
                return (
                  <button key={val} type="button" onClick={() => setAccountType(val)} style={{
                    display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start', textAlign: 'left',
                    padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                    border: `1px solid ${selected ? 'var(--anthropic-orange)' : 'var(--border)'}`,
                    background: selected ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                  }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: selected ? 'var(--anthropic-orange)' : 'var(--text-primary)' }}>{title}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>{desc}</span>
                  </button>
                )
              })}
            </div>
          </Field>
        )}

        <Field label={pt ? 'Nome' : 'Name'}>
          <input style={input} value={an} onChange={e => setAn(e.target.value)} placeholder={pt ? 'Nome completo' : 'Full name'} />
        </Field>
        <Field label="Email">
          <input style={input} value={ae} onChange={e => setAe(e.target.value)} placeholder="name@example.com" />
        </Field>
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

        {accountType === 'owner' ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '9px 11px' }}>
            {pt
              ? 'Owners têm acesso total a todos os times e máquinas — sem escopo de times.'
              : 'Owners have full access to all teams and machines — no team scope.'}
          </div>
        ) : accountType === 'admin' ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '9px 11px' }}>
            {pt
              ? 'Admins têm acesso quase total — sem escopo de times (não gerenciam owners nem outros admins).'
              : 'Admins have near-full access — no team scope (they cannot manage owners or other admins).'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>{pt ? 'Escopo (times)' : 'Scope (teams)'}</span>
              <button type="button" style={ghostBtn} onClick={addRow}><Plus size={13} /> {pt ? 'Adicionar time' : 'Add team'}</button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5, margin: 0 }}>
              {pt
                ? 'Um manager gerencia os times selecionados (e suas máquinas). Um user tem leitura restrita.'
                : "A manager manages the selected teams (and their machines). A user has scoped read access."}
            </p>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select style={{ ...input, flex: 2 }} value={r.teamId} onChange={e => updateRow(i, { teamId: e.target.value })}>
                  <option value="">{pt ? 'Selecione o time…' : 'Select team…'}</option>
                  {teams.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
                </select>
                <select style={{ ...input, flex: 1 }} value={r.role} onChange={e => updateRow(i, { role: e.target.value as 'manager' | 'user' })}>
                  <option value="user">user</option>
                  <option value="manager">manager</option>
                </select>
                <button type="button" onClick={() => removeRow(i)} disabled={rows.length === 1}
                  style={{ ...trashBtn, opacity: rows.length === 1 ? 0.35 : 1, cursor: rows.length === 1 ? 'not-allowed' : 'pointer' }}
                  aria-label={pt ? 'Remover time' : 'Remove team'}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        </>)}

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
                  <button type="button" style={ghostBtn} onClick={e => { e.stopPropagation(); void copy(label, value) }} aria-label={`Copy ${label}`}>
                    {copied === label ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
                {copyFailed === label && (
                  <span style={{ fontSize: 10, color: '#ef4444', lineHeight: 1.4 }}>
                    {pt ? 'falha ao copiar — selecione manualmente' : 'copy failed — select manually'}
                  </span>
                )}
              </div>
            ))}
            {created.machineToken && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{pt ? 'Comando de conexão' : 'Connect command'}</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <code style={{ flex: 1, fontSize: 11.5, fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', wordBreak: 'break-all', color: 'var(--text-secondary)' }}>
                    {connectCmd}
                  </code>
                  <button type="button" style={ghostBtn} onClick={e => { e.stopPropagation(); void copy('connect', connectCmd) }} aria-label="Copy connect command">
                    {copied === 'connect' ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
                {copyFailed === 'connect' && (
                  <span style={{ fontSize: 10, color: '#ef4444', lineHeight: 1.4 }}>
                    {pt ? 'falha ao copiar — selecione manualmente' : 'copy failed — select manually'}
                  </span>
                )}
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
      </Drawer>

      {/* Edit account drawer — while a shown-once temp password is on screen, backdrop/X are no-ops
          so it can't be lost to a stray click (Close/Save are explicit). */}
      <Drawer open={editOpen} onClose={() => { if (!tempPassword) setEditOpen(false) }} title={pt ? 'Editar conta' : 'Edit account'}>
        {drawerErr(editErr)}
        <Field label={pt ? 'Nome' : 'Name'}>
          <input style={input} value={en} onChange={e => setEn(e.target.value)} placeholder={pt ? 'Nome completo' : 'Full name'} />
        </Field>

        {editIsOwner ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '9px 11px' }}>
            {pt ? 'Owners e admins não têm escopo de times.' : 'Owners and admins have no team scope.'}
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
                <button type="button" style={ghostBtn} onClick={e => { e.stopPropagation(); void copy('temp', tempPassword) }} aria-label="Copy temp password">
                  {copied === 'temp' ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
              {copyFailed === 'temp' && (
                <span style={{ fontSize: 10, color: '#ef4444', lineHeight: 1.4 }}>
                  {pt ? 'falha ao copiar — selecione manualmente' : 'copy failed — select manually'}
                </span>
              )}
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
    </div>
  )
}
