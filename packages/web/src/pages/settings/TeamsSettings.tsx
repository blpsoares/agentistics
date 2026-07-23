import React, { useEffect, useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Trash2, Settings } from 'lucide-react'
import type { AppContext } from '../../lib/app-context'
import { SectionHeader, Select } from './primitives'
import { Drawer } from './Drawer'

interface Team { _id: string; name: string }
interface Membership { teamId: string; role: 'manager' | 'user' }
interface Account { id: string; name: string; email: string; role: 'owner' | 'member'; memberships: Membership[] }
interface Machine { id: string; machineName: string; user: string; teamId?: string; accountId?: string; accountName?: string; accountEmail?: string; lastSeenAt: string | null }

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
  const { lang, me } = useOutletContext<AppContext>()
  const pt = lang === 'pt'
  const viewerIsOwner = me?.role === 'owner'
  const managedTeamIds = new Set((me?.memberships ?? []).filter(m => m.role === 'manager').map(m => m.teamId))

  const [teams, setTeams] = useState<Team[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [machines, setMachines] = useState<Machine[]>([])
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [t, a, m] = await Promise.all([
        fetch('/api/iam/teams').then(r => r.json() as Promise<{ teams: Team[] }>),
        fetch('/api/iam/accounts').then(r => r.json() as Promise<{ accounts: Account[] }>),
        fetch('/api/iam/machines').then(r => r.json() as Promise<{ machines: Machine[] }>),
      ])
      setTeams(t.teams ?? []); setAccounts(a.accounts ?? []); setMachines(m.machines ?? [])
    } catch (e) { setErr(String(e)) }
  }, [])
  useEffect(() => { void load() }, [load])

  // ── team create drawer ──
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
    accounts.filter(a => a.role !== 'owner' && a.memberships.some(m => m.teamId === teamId)).length

  // ── manage team drawer ──
  const [manageOpen, setManageOpen] = useState(false)
  const [manageTeamId, setManageTeamId] = useState<string | null>(null)
  const [manageErr, setManageErr] = useState<string | null>(null)
  const [addAccountId, setAddAccountId] = useState('')
  const [addAccountRole, setAddAccountRole] = useState<'manager' | 'user'>('user')
  const [addMachineId, setAddMachineId] = useState('')

  function openManageDrawer(teamId: string) {
    setManageTeamId(teamId)
    setManageErr(null)
    setAddAccountId('')
    setAddAccountRole('user')
    setAddMachineId('')
    setManageOpen(true)
  }

  async function removeAccountFromTeam(accountId: string, teamId: string) {
    const account = accounts.find(a => a.id === accountId)
    if (!account) return
    const newMemberships = account.memberships.filter(m => m.teamId !== teamId)
    const res = await fetch('/api/iam/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: accountId, memberships: newMemberships }),
    })
    if (!res.ok) { const d = await res.json() as { error?: string }; setManageErr(d.error || `HTTP ${res.status}`); return }
    void load()
  }

  async function addAccountToTeam() {
    if (!addAccountId || !manageTeamId) return
    const account = accounts.find(a => a.id === addAccountId)
    if (!account) return
    const existing = account.memberships.find(m => m.teamId === manageTeamId)
    const newMemberships = existing
      ? account.memberships
      : [...account.memberships, { teamId: manageTeamId, role: addAccountRole }]
    const res = await fetch('/api/iam/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: addAccountId, memberships: newMemberships }),
    })
    if (!res.ok) { const d = await res.json() as { error?: string }; setManageErr(d.error || `HTTP ${res.status}`); return }
    setAddAccountId('')
    setAddAccountRole('user')
    void load()
  }

  async function removeMachineFromTeam(machineId: string) {
    const res = await fetch('/api/iam/machines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reassignId: machineId, teamId: 'default' }),
    })
    if (!res.ok) { const d = await res.json() as { error?: string }; setManageErr(d.error || `HTTP ${res.status}`); return }
    void load()
  }

  async function addMachineToTeam() {
    if (!addMachineId || !manageTeamId) return
    const res = await fetch('/api/iam/machines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reassignId: addMachineId, teamId: manageTeamId }),
    })
    if (!res.ok) { const d = await res.json() as { error?: string }; setManageErr(d.error || `HTTP ${res.status}`); return }
    setAddMachineId('')
    void load()
  }

  const drawerErr = (m: string | null) => m && (
    <div style={{ fontSize: 12, color: '#ef4444', background: 'color-mix(in srgb, #ef4444 12%, transparent)', border: '1px solid color-mix(in srgb, #ef4444 35%, transparent)', borderRadius: 7, padding: '8px 10px' }}>{m}</div>
  )

  const canManageTeam = (teamId: string) => viewerIsOwner || managedTeamIds.has(teamId)
  const manageTeam = teams.find(t => t._id === manageTeamId)
  const teamMembers = manageTeamId ? accounts.filter(a => a.memberships.some(m => m.teamId === manageTeamId)) : []
  const teamMachines = manageTeamId ? machines.filter(m => m.teamId === manageTeamId) : []
  const eligibleAccounts = accounts.filter(a => {
    if (a.role === 'owner') return false
    if (manageTeamId && a.memberships.some(m => m.teamId === manageTeamId)) return false
    if (!viewerIsOwner) {
      // Manager: can only add accounts that are either (1) not yet in any team, or (2) only in teams they manage, as user
      if (a.memberships.length === 0) return true
      return a.memberships.every(m => m.role === 'user' && managedTeamIds.has(m.teamId))
    }
    return true
  })
  const eligibleMachines = manageTeamId ? machines.filter(m => {
    if (m.teamId === manageTeamId) return false
    if (!viewerIsOwner && m.teamId && !managedTeamIds.has(m.teamId)) return false
    return true
  }) : []

  const roleOptions: { value: 'manager' | 'user'; label: string }[] = viewerIsOwner
    ? [{ value: 'user', label: 'user' }, { value: 'manager', label: 'manager' }]
    : [{ value: 'user', label: 'user' }]

  const ROLE_BADGE_COLORS: Record<string, string> = { manager: 'var(--anthropic-orange)', user: '#3b82f6' }
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
              <th style={{ ...th, width: 80 }} />
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
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canManageTeam(t._id) && (
                    <button onClick={() => openManageDrawer(t._id)} style={{ ...trashBtn, color: 'var(--text-tertiary)' }} aria-label="Manage team" title={pt ? 'Gerenciar' : 'Manage'}>
                      <Settings size={14} />
                    </button>
                  )}
                  {t._id !== 'default' && (
                    <button onClick={() => void deleteTeam(t._id)} style={trashBtn} aria-label="Delete team"><Trash2 size={14} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Team create drawer */}
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

      {/* Manage team drawer */}
      <Drawer open={manageOpen} onClose={() => setManageOpen(false)} title={manageTeam?.name ?? ''}>
        {drawerErr(manageErr)}

        {/* Members section */}
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.07em', textTransform: 'uppercase', marginTop: 4 }}>
          {pt ? 'Membros' : 'Members'}
        </div>
        {teamMembers.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', padding: '12px 0' }}>
            {pt ? 'Nenhum membro neste time.' : 'No members in this team.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {teamMembers.map(a => {
              const membership = a.memberships.find(m => m.teamId === manageTeamId)
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 7 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{a.name}</span>
                      {membership && <RoleBadge role={membership.role} />}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{a.email}</span>
                  </div>
                  <button type="button" style={{ ...ghostBtn, padding: '5px 10px', color: '#ef4444', fontSize: 11.5 }} onClick={() => window.confirm(pt ? 'Remover este membro?' : 'Remove this member?') && void removeAccountFromTeam(a.id, manageTeamId!)}>
                    {pt ? 'Remover' : 'Remove'}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Add member row */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginTop: 8 }}>
          <div style={{ flex: 2 }}>
            <Field label={pt ? 'Adicionar membro' : 'Add member'}>
              <Select
                value={addAccountId}
                onChange={v => setAddAccountId(v)}
                options={[
                  { value: '', label: pt ? 'Selecione…' : 'Select…' },
                  ...eligibleAccounts.map(a => ({ value: a.id, label: `${a.name} — ${a.email}` })),
                ]}
                placeholder={pt ? 'Selecione…' : 'Select…'}
              />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label={pt ? 'Papel' : 'Role'}>
              <Select
                value={addAccountRole}
                onChange={v => setAddAccountRole(v as 'manager' | 'user')}
                options={roleOptions}
              />
            </Field>
          </div>
          <button type="button" style={{ ...primaryBtn, marginBottom: 0 }} onClick={() => void addAccountToTeam()} disabled={!addAccountId}>
            <Plus size={13} />
          </button>
        </div>

        {/* Machines section */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 18, marginTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14 }}>
            {pt ? 'Máquinas' : 'Machines'}
          </div>
          {teamMachines.length === 0 ? (
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', padding: '12px 0' }}>
              {pt ? 'Nenhuma máquina neste time.' : 'No machines in this team.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {teamMachines.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 7 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{m.machineName}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {m.accountName ? `${m.accountName} — ${m.accountEmail}` : m.user} · {m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleString() : (pt ? 'nunca' : 'never')}
                    </span>
                  </div>
                  <button type="button" style={{ ...ghostBtn, padding: '5px 10px', color: '#ef4444', fontSize: 11.5 }} onClick={() => window.confirm(pt ? 'Remover desta equipe?' : 'Remove from team?') && void removeMachineFromTeam(m.id)}>
                    {pt ? 'Remover' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add machine row */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <Field label={pt ? 'Adicionar máquina' : 'Add machine'}>
                <Select
                  value={addMachineId}
                  onChange={v => setAddMachineId(v)}
                  options={[
                    { value: '', label: pt ? 'Selecione…' : 'Select…' },
                    ...eligibleMachines.map(m => ({ value: m.id, label: `${m.machineName} — ${m.accountName ?? m.user}` })),
                  ]}
                  placeholder={pt ? 'Selecione…' : 'Select…'}
                />
              </Field>
            </div>
            <button type="button" style={{ ...primaryBtn, marginBottom: 0 }} onClick={() => void addMachineToTeam()} disabled={!addMachineId}>
              <Plus size={13} />
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
          <button style={ghostBtn} onClick={() => setManageOpen(false)}>{pt ? 'Fechar' : 'Close'}</button>
        </div>
      </Drawer>
    </div>
  )
}
