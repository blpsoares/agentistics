import React, { useEffect, useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import type { AppContext } from '../../lib/app-context'
import { SectionHeader } from './primitives'
import { Drawer } from './Drawer'

interface Team { _id: string; name: string }
interface Membership { teamId: string; role: 'manager' | 'user' }
interface Account { id: string; name: string; email: string; role: 'owner' | 'member'; memberships: Membership[] }

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
  owner: '#a855f7', manager: 'var(--anthropic-orange)', user: '#3b82f6',
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
  const { lang } = useOutletContext<AppContext>()
  const pt = lang === 'pt'

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
  const [atTeam, setAtTeam] = useState(''); const [atRole, setAtRole] = useState<'manager' | 'user'>('user')
  const [accountErr, setAccountErr] = useState<string | null>(null)

  function openAccountDrawer() {
    setAn(''); setAe(''); setAp(''); setAtTeam(''); setAtRole('user'); setAccountErr(null)
    setAccountOpen(true)
  }
  async function createAccount() {
    if (!an.trim() || !ae.trim() || ap.length < 8 || !atTeam) {
      setAccountErr(pt ? 'Preencha nome, email, senha (8+) e time.' : 'Fill name, email, password (8+) and team.')
      return
    }
    const res = await fetch('/api/iam/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: an.trim(), email: ae.trim(), password: ap, memberships: [{ teamId: atTeam, role: atRole }] }),
    })
    if (!res.ok) { const d = await res.json() as { error?: string }; setAccountErr(d.error || `HTTP ${res.status}`); return }
    setAccountOpen(false); void load()
  }
  async function deleteAccount(id: string) {
    await fetch('/api/iam/accounts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    void load()
  }

  const teamNameOf = (id: string) => teams.find(t => t._id === id)?.name ?? id

  const roleLegend = pt
    ? [['Owner', 'controle total'], ['Manager', 'gerencia usuários e tokens do seu time'], ['User', 'leitura restrita']]
    : [['Owner', 'full control'], ['Manager', "manages their team's users & tokens"], ['User', 'scoped read']]

  const drawerErr = (m: string | null) => m && (
    <div style={{ fontSize: 12, color: '#ef4444', background: 'color-mix(in srgb, #ef4444 12%, transparent)', border: '1px solid color-mix(in srgb, #ef4444 35%, transparent)', borderRadius: 7, padding: '8px 10px' }}>{m}</div>
  )

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
                <td style={td}><RoleBadge role={a.role === 'owner' ? 'owner' : (a.memberships[0]?.role ?? 'user')} /></td>
                <td style={td}>
                  <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
                    {a.role === 'owner'
                      ? <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                      : a.memberships.map(m => (
                        <span key={m.teamId} style={{
                          display: 'inline-block', padding: '2px 7px', borderRadius: 6, fontSize: 10.5,
                          background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                        }}>{teamNameOf(m.teamId)}</span>
                      ))}
                  </span>
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {a.role !== 'owner' && (
                    <button onClick={() => void deleteAccount(a.id)} style={trashBtn} aria-label="Delete account"><Trash2 size={14} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Account drawer */}
      <Drawer open={accountOpen} onClose={() => setAccountOpen(false)} title={pt ? 'Nova conta' : 'New account'}>
        {drawerErr(accountErr)}
        <Field label={pt ? 'Nome' : 'Name'}>
          <input style={input} value={an} onChange={e => setAn(e.target.value)} placeholder={pt ? 'Nome completo' : 'Full name'} />
        </Field>
        <Field label="Email">
          <input style={input} value={ae} onChange={e => setAe(e.target.value)} placeholder="name@example.com" />
        </Field>
        <Field label={pt ? 'Senha (8+)' : 'Password (8+)'}>
          <input style={input} type="password" value={ap} onChange={e => setAp(e.target.value)} placeholder="••••••••" />
        </Field>
        <Field label={pt ? 'Time' : 'Team'}>
          <select style={input} value={atTeam} onChange={e => setAtTeam(e.target.value)}>
            <option value="">{pt ? 'Selecione…' : 'Select…'}</option>
            {teams.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label={pt ? 'Papel' : 'Role'}>
          <select style={input} value={atRole} onChange={e => setAtRole(e.target.value as 'manager' | 'user')}>
            <option value="user">user</option>
            <option value="manager">manager</option>
          </select>
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button style={ghostBtn} onClick={() => setAccountOpen(false)}>{pt ? 'Cancelar' : 'Cancel'}</button>
          <button style={primaryBtn} onClick={() => void createAccount()}><Plus size={14} /> {pt ? 'Criar conta' : 'Create account'}</button>
        </div>
      </Drawer>
    </div>
  )
}
