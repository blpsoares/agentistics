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
