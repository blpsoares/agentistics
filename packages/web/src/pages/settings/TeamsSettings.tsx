import React, { useEffect, useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import type { AppContext } from '../../lib/app-context'
import { SectionHeader } from './primitives'
import { Drawer } from './Drawer'

interface Team { _id: string; name: string }
interface Membership { teamId: string; role: 'manager' | 'user' }
interface Account { id: string; role: 'owner' | 'admin' | 'member'; memberships: Membership[] }

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

// ── page ──────────────────────────────────────────────────────────────────
export default function TeamsSettings() {
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

  // ── team drawer ──
  const [teamOpen, setTeamOpen] = useState(false)
  const [teamName, setTeamName] = useState('')
  const [teamErr, setTeamErr] = useState<string | null>(null)

  function openTeamDrawer() { setTeamName(''); setTeamErr(null); setTeamOpen(true) }
  async function createTeam() {
    if (!teamName.trim()) { setTeamErr(pt ? 'Informe o nome do time.' : 'Enter a team name.'); return }
    const res = await fetch('/api/iam/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: teamName.trim() }),
    })
    if (!res.ok) { const d = await res.json().catch(() => ({})) as { error?: string }; setTeamErr(d.error || `HTTP ${res.status}`); return }
    setTeamOpen(false); void load()
  }
  async function deleteTeam(id: string) {
    await fetch('/api/iam/teams', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    void load()
  }

  const memberCountOf = (teamId: string) =>
    accounts.filter(a => a.role !== 'owner' && a.role !== 'admin' && a.memberships.some(m => m.teamId === teamId)).length

  const drawerErr = (m: string | null) => m && (
    <div style={{ fontSize: 12, color: '#ef4444', background: 'color-mix(in srgb, #ef4444 12%, transparent)', border: '1px solid color-mix(in srgb, #ef4444 35%, transparent)', borderRadius: 7, padding: '8px 10px' }}>{m}</div>
  )

  return (
    <div>
      <SectionHeader label={pt ? 'Times' : 'Teams'} />

      <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 18px' }}>
        {pt
          ? 'Times agrupam usuários e máquinas para escopo de acesso e agregação de métricas.'
          : 'Teams group users and machines for access scoping and metric aggregation.'}
      </p>

      {err && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 12 }}>{err}</div>}

      {/* Teams */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{pt ? 'Times' : 'Teams'}</div>
        <button style={primaryBtn} onClick={openTeamDrawer}><Plus size={14} /> {pt ? 'Novo time' : 'New team'}</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>{pt ? 'Nome' : 'Name'}</th>
              <th style={th}>{pt ? 'Membros' : 'Members'}</th>
              <th style={{ ...th, width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {teams.length === 0 && (
              <tr><td style={{ ...td, color: 'var(--text-tertiary)' }} colSpan={3}>{pt ? 'Nenhum time.' : 'No teams.'}</td></tr>
            )}
            {teams.map(t => (
              <tr key={t._id}>
                <td style={{ ...td, color: 'var(--text-primary)', fontWeight: 500 }}>
                  {t.name}
                  {t._id === 'default' && <em style={{ color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: 6 }}>({pt ? 'padrão' : 'default'})</em>}
                </td>
                <td style={td}>{memberCountOf(t._id)}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {t._id !== 'default' && (
                    <button onClick={() => void deleteTeam(t._id)} style={trashBtn} aria-label="Delete team"><Trash2 size={14} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Team drawer */}
      <Drawer open={teamOpen} onClose={() => setTeamOpen(false)} title={pt ? 'Novo time' : 'New team'}>
        {drawerErr(teamErr)}
        <Field label={pt ? 'Nome do time' : 'Team name'}>
          <input style={input} value={teamName} onChange={e => setTeamName(e.target.value)} placeholder={pt ? 'Nome do time' : 'Team name'} />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button style={ghostBtn} onClick={() => setTeamOpen(false)}>{pt ? 'Cancelar' : 'Cancel'}</button>
          <button style={primaryBtn} onClick={() => void createTeam()}><Plus size={14} /> {pt ? 'Criar time' : 'Create team'}</button>
        </div>
      </Drawer>
    </div>
  )
}
