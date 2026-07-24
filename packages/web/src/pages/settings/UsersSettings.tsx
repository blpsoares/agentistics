import React, { useEffect, useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Trash2, Copy, Check, Dice5, KeyRound, Pencil, X } from 'lucide-react'
import { generatePassword } from '../../lib/password'
import type { AppContext } from '../../lib/app-context'
import { SectionHeader, Section, Checkbox, Select } from './primitives'
import { Drawer } from './Drawer'

interface Team { _id: string; name: string }
interface Membership { teamId: string; role: 'manager' | 'user' }
interface Account { id: string; name: string; email: string; role: 'owner' | 'member'; memberships: Membership[] }
interface MachineRow { name: string; teamId: string }
interface LinkedMachine { id: string; machineName: string; teamId?: string; accountId?: string; accountIds?: string[]; lastSeenAt: string | null }

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

// Read-only labelled value used in the read-first drawer sections.
function ReadField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{value}</span>
    </div>
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
  const { lang, me } = useOutletContext<AppContext>()
  const pt = lang === 'pt'
  const viewerIsOwner = me?.role === 'owner'

  const [teams, setTeams] = useState<Team[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [machines, setMachines] = useState<LinkedMachine[]>([])
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [t, a, m] = await Promise.all([
        fetch('/api/iam/teams').then(r => r.json() as Promise<{ teams: Team[] }>),
        fetch('/api/iam/accounts').then(r => r.json() as Promise<{ accounts: Account[] }>),
        fetch('/api/iam/machines').then(r => r.json() as Promise<{ machines: LinkedMachine[] }>),
      ])
      setTeams(t.teams ?? []); setAccounts(a.accounts ?? []); setMachines(m.machines ?? [])
    } catch (e) { setErr(String(e)) }
  }, [])
  useEffect(() => { void load() }, [load])

  // Scoping helpers
  const managedTeamIds = new Set((me?.memberships ?? []).filter(m => m.role === 'manager').map(m => m.teamId))
  const assignableTeams = viewerIsOwner ? teams : teams.filter(t => managedTeamIds.has(t._id))

  // ── account drawer ──
  const [accountOpen, setAccountOpen] = useState(false)
  const [an, setAn] = useState(''); const [ae, setAe] = useState(''); const [ap, setAp] = useState('')
  const [accountType, setAccountType] = useState<'owner' | 'member'>('member')
  const [rows, setRows] = useState<Membership[]>([{ teamId: '', role: 'user' }])
  const [machineRows, setMachineRows] = useState<MachineRow[]>([])
  const [accountErr, setAccountErr] = useState<string | null>(null)
  const [mustChange, setMustChange] = useState(true)
  const [pwVisible, setPwVisible] = useState(false)
  // one-time result after a successful create (credentials + machine tokens shown once)
  const [created, setCreated] = useState<null | { email: string; password: string; machineTokens?: { name: string; token: string }[] }>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState<string | null>(null)

  // ── edit drawer ──
  const [editOpen, setEditOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editIsOwner, setEditIsOwner] = useState(false)
  const [en, setEn] = useState('')
  const [eRows, setERows] = useState<Membership[]>([{ teamId: '', role: 'user' }])
  const [linkedMachines, setLinkedMachines] = useState<LinkedMachine[]>([])
  const [loadingMachines, setLoadingMachines] = useState(false)
  const [editErr, setEditErr] = useState<string | null>(null)
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  // Per-section edit toggle inside the (read-first) edit drawer. Only one section edits at a time.
  const [editingSection, setEditingSection] = useState<null | 'identity' | 'teams' | 'machines'>(null)
  // Add machine inline form in edit drawer
  const [addMachineName, setAddMachineName] = useState('')
  const [addMachineTeam, setAddMachineTeam] = useState('')
  const [addedMachineToken, setAddedMachineToken] = useState<string | null>(null)
  const [addedMachineName, setAddedMachineName] = useState<string | null>(null)
  // Rename machine in edit drawer
  const [renamingMachineId, setRenamingMachineId] = useState<string | null>(null)
  const [renameMachineValue, setRenameMachineValue] = useState('')

  function openAccountDrawer() {
    setAn(''); setAe(''); setAp(''); setAccountType('member'); setRows([{ teamId: '', role: 'user' }])
    setMachineRows([]); setAccountErr(null)
    setMustChange(true); setPwVisible(false); setCreated(null); setCopied(null); setCopyFailed(null)
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

  function addMachineRow() { setMachineRows(rs => [...rs, { name: '', teamId: '' }]) }
  function removeMachineRow(i: number) { setMachineRows(rs => rs.filter((_, idx) => idx !== i)) }
  function updateMachineRow(i: number, patch: Partial<MachineRow>) {
    setMachineRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }

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
    const machines = machineRows.filter(m => m.name.trim()).map(m => ({ name: m.name.trim(), teamId: m.teamId || undefined }))
    const body: Record<string, unknown> = {
      name: an.trim(), email: ae.trim(), password: ap, role: accountType, memberships,
      mustChangePassword: mustChange,
    }
    if (machines.length > 0) body.machines = machines
    const res = await fetch('/api/iam/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { const d = await res.json() as { error?: string }; setAccountErr(d.error || `HTTP ${res.status}`); return }
    const d = await res.json() as { machineTokens?: { name: string; token: string }[] }
    setAccountErr(null) // clear any prior error (e.g. "email already exists") on success
    setCreated({
      email: ae.trim(), password: ap,
      machineTokens: d.machineTokens,
    })
    void load()
  }
  async function deleteAccount(id: string) {
    await fetch('/api/iam/accounts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    void load()
  }

  async function openEditDrawer(a: Account) {
    setEditId(a.id); setEditIsOwner(a.role === 'owner'); setEn(a.name)
    setERows(a.memberships.length ? a.memberships.map(m => ({ ...m })) : [{ teamId: '', role: 'user' }])
    setEditErr(null); setTempPassword(null); setAddMachineName(''); setAddMachineTeam(''); setAddedMachineToken(null); setAddedMachineName(null)
    setRenamingMachineId(null); setRenameMachineValue('')
    setEditingSection(null)
    setEditOpen(true)
    // Fetch linked machines
    setLoadingMachines(true)
    try {
      const res = await fetch('/api/iam/machines')
      const d = await res.json() as { machines: LinkedMachine[] }
      setLinkedMachines((d.machines ?? []).filter(m => (m.accountIds ?? (m.accountId ? [m.accountId] : [])).includes(a.id)))
    } catch (e) {
      setEditErr(String(e))
    } finally {
      setLoadingMachines(false)
    }
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

  // Per-section saves (read-first drawer): each Section saves only its own fields.
  async function saveIdentity() {
    if (!editId) return
    if (!en.trim()) { setEditErr(pt ? 'O nome não pode ficar vazio.' : 'Name cannot be empty.'); return }
    const res = await fetch('/api/iam/accounts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editId, name: en.trim() }),
    })
    if (!res.ok) { const d = await res.json() as { error?: string }; setEditErr(d.error || `HTTP ${res.status}`); return }
    setEditErr(null); setEditingSection(null); void load()
  }
  async function saveTeams() {
    if (!editId) return
    const res = await fetch('/api/iam/accounts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editId, memberships: eRows.filter(r => r.teamId) }),
    })
    if (!res.ok) { const d = await res.json() as { error?: string }; setEditErr(d.error || `HTTP ${res.status}`); return }
    setEditErr(null); setEditingSection(null); void load()
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

  async function addMachine() {
    if (!editId || !addMachineName.trim()) return
    const body: Record<string, unknown> = { accountId: editId, name: addMachineName.trim() }
    if (addMachineTeam) body.teamId = addMachineTeam
    const res = await fetch('/api/iam/machines', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { const d = await res.json() as { error?: string }; setEditErr(d.error || `HTTP ${res.status}`); return }
    const d = await res.json() as { token: string }
    setAddedMachineToken(d.token)
    setAddedMachineName(addMachineName.trim())
    setAddMachineName(''); setAddMachineTeam('')
    // Refetch machines
    const mRes = await fetch('/api/iam/machines')
    const mData = await mRes.json() as { machines: LinkedMachine[] }
    setLinkedMachines((mData.machines ?? []).filter(m => (m.accountIds ?? (m.accountId ? [m.accountId] : [])).includes(editId)))
  }

  async function revokeMachine(id: string) {
    const res = await fetch('/api/iam/machines', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) { setEditErr(`HTTP ${res.status}`); return }
    // Refetch machines
    if (editId) {
      const mRes = await fetch('/api/iam/machines')
      const mData = await mRes.json() as { machines: LinkedMachine[] }
      setLinkedMachines((mData.machines ?? []).filter(m => (m.accountIds ?? (m.accountId ? [m.accountId] : [])).includes(editId)))
    }
  }

  async function renameMachine(id: string, name: string) {
    const res = await fetch('/api/iam/machines', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ renameId: id, name }),
    })
    if (!res.ok) { setEditErr(`HTTP ${res.status}`); return }
    setRenamingMachineId(null)
    // Refetch machines
    if (editId) {
      const mRes = await fetch('/api/iam/machines')
      const mData = await mRes.json() as { machines: LinkedMachine[] }
      setLinkedMachines((mData.machines ?? []).filter(m => (m.accountIds ?? (m.accountId ? [m.accountId] : [])).includes(editId)))
    }
  }

  function startRenameMachine(id: string, currentName: string) {
    setRenamingMachineId(id)
    setRenameMachineValue(currentName)
  }

  function cancelRenameMachine() {
    setRenamingMachineId(null)
    setRenameMachineValue('')
  }

  function confirmRenameMachine() {
    if (renamingMachineId && renameMachineValue.trim()) {
      void renameMachine(renamingMachineId, renameMachineValue.trim())
    }
  }

  function handleRenameMachineKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      confirmRenameMachine()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelRenameMachine()
    }
  }

  const teamNameOf = (id: string) => teams.find(t => t._id === id)?.name ?? id

  const roleLegend = pt
    ? [['Owner', 'controle total'], ['Manager', 'gerencia usuários e tokens do seu time'], ['User', 'leitura restrita']]
    : [['Owner', 'full control'], ['Manager', "manages their team's users & tokens"], ['User', 'scoped read']]

  const drawerErr = (m: string | null) => m && (
    <div style={{ fontSize: 12, color: '#ef4444', background: 'color-mix(in srgb, #ef4444 12%, transparent)', border: '1px solid color-mix(in srgb, #ef4444 35%, transparent)', borderRadius: 7, padding: '8px 10px' }}>{m}</div>
  )

  function canDeleteClient(a: Account): boolean {
    if (!me) return false
    if (a.id === me.id) return false                    // never yourself
    if (a.role === 'owner') return me.role === 'owner' && ownerCount > 1   // last-owner protected
    // target is a member:
    if (me.role === 'owner') return true
    const managed = new Set(me.memberships.filter(m => m.role === 'manager').map(m => m.teamId))
    return a.memberships.length > 0 && a.memberships.every(m => m.role === 'user' && managed.has(m.teamId))
  }
  // Mirror the server PATCH authz: self (rename) always; owner edits anyone; else same rule as delete.
  function canEditClient(a: Account): boolean {
    if (!me) return false
    if (a.id === me.id) return true            // self rename
    if (me.role === 'owner') return true
    return canDeleteClient(a)                  // manager → managed user-members
  }

  // Build connect commands based on token type (composite vs raw)
  const connectCmdFor = (token: string) => {
    const isComposite = token.startsWith('act1_')
    if (isComposite) {
      return `agentop member connect --token ${token}`
    }
    // For raw tokens, fallback to window.location.origin (no central URL available in UsersSettings)
    return `agentop member connect --endpoint ${window.location.origin} --token ${token}`
  }

  // Compute totals
  const totalAccounts = accounts.length
  const ownerCount = accounts.filter(a => a.role === 'owner').length
  const managerCount = accounts.filter(a => a.role === 'member' && a.memberships.some(m => m.role === 'manager')).length
  const userCount = accounts.filter(a => a.role === 'member' && !a.memberships.some(m => m.role === 'manager')).length

  // Helper to count machines per account
  const machineCountFor = (accountId: string) => machines.filter(m => (m.accountIds ?? (m.accountId ? [m.accountId] : [])).includes(accountId)).length

  // Edit-drawer derived data (read-first sections)
  const editAccount = accounts.find(a => a.id === editId) ?? null
  const canEditEdit = editAccount ? canEditClient(editAccount) : false
  const sectionLabels = {
    edit: pt ? 'Editar' : 'Edit',
    save: pt ? 'Salvar' : 'Save',
    cancel: pt ? 'Cancelar' : 'Cancel',
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

      {/* Totals summary */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{
          display: 'inline-block', padding: '4px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 600,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
        }}>
          {pt ? 'Total' : 'Total'}: {totalAccounts}
        </span>
        {ownerCount > 0 && (
          <span style={{
            display: 'inline-block', padding: '4px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 600,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
          }}>
            Owners: {ownerCount}
          </span>
        )}
        {managerCount > 0 && (
          <span style={{
            display: 'inline-block', padding: '4px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 600,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
          }}>
            Managers: {managerCount}
          </span>
        )}
        {userCount > 0 && (
          <span style={{
            display: 'inline-block', padding: '4px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 600,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
          }}>
            Users: {userCount}
          </span>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>{pt ? 'Nome' : 'Name'}</th>
              <th style={th}>Email</th>
              <th style={th}>{pt ? 'Papel' : 'Role'}</th>
              <th style={th}>{pt ? 'Times' : 'Teams'}</th>
              <th style={th}>{pt ? 'Máquinas' : 'Machines'}</th>
              <th style={{ ...th, width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 && (
              <tr><td style={{ ...td, color: 'var(--text-tertiary)' }} colSpan={6}>{pt ? 'Nenhuma conta.' : 'No accounts.'}</td></tr>
            )}
            {accounts.map(a => {
              const clickable = canEditClient(a)
              return (
              <tr key={a.id}
                onClick={clickable ? () => void openEditDrawer(a) : undefined}
                style={{ cursor: clickable ? 'pointer' : 'default' }}
                onMouseEnter={clickable ? e => { e.currentTarget.style.background = 'var(--bg-elevated)' } : undefined}
                onMouseLeave={clickable ? e => { e.currentTarget.style.background = '' } : undefined}>
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
                <td style={td}>{machineCountFor(a.id)}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canEditClient(a) && (
                    <button onClick={e => { e.stopPropagation(); void openEditDrawer(a) }} style={{ ...trashBtn, color: 'var(--text-tertiary)' }} aria-label="Edit account"><Pencil size={14} /></button>
                  )}
                  {canDeleteClient(a) && (
                    <button onClick={e => { e.stopPropagation(); void deleteAccount(a.id) }} style={trashBtn} aria-label="Delete account"><Trash2 size={14} /></button>
                  )}
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Account drawer — while showing shown-once secrets, only the explicit "Done" button closes it
          (backdrop/X are no-ops) so the machine token/command can't be lost to a stray click. */}
      <Drawer open={accountOpen} onClose={() => { if (!created) setAccountOpen(false) }} title={pt ? 'Nova conta' : 'New account'}>
        {drawerErr(accountErr)}

        {!created && (<>
        {/* IDENTITY SECTION */}
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.07em', textTransform: 'uppercase', marginTop: 4 }}>
          {pt ? 'Identidade' : 'Identity'}
        </div>

        {/* Account type — Owner is offered only to an owner viewer. */}
        {viewerIsOwner && (
          <Field label={pt ? 'Tipo de conta' : 'Account type'}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {([
                ['member', pt ? 'Membro com escopo' : 'Scoped member', pt ? 'Acesso restrito a times' : 'Access scoped to teams'],
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

        {/* SECURITY SECTION */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 18, marginTop: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14 }}>
            {pt ? 'Segurança' : 'Security'}
          </div>
          <Checkbox checked={mustChange} onChange={setMustChange} label={pt ? 'Exigir troca de senha no primeiro login' : 'Require password change on first login'} />
        </div>

        {/* ACCESS (TEAMS) SECTION */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 18, marginTop: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14 }}>
            {pt ? 'Acesso' : 'Access'}
          </div>

          {accountType === 'owner' ? (
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '9px 11px' }}>
              {pt
                ? 'Owners têm acesso total a todos os times e máquinas — sem escopo de times.'
                : 'Owners have full access to all teams and machines — no team scope.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                  <div style={{ flex: 2 }}>
                    <Select
                      value={r.teamId}
                      onChange={v => updateRow(i, { teamId: v })}
                      options={[
                        { value: '', label: pt ? 'Selecione o time…' : 'Select team…' },
                        ...assignableTeams.map(t => ({ value: t._id, label: t.name })),
                      ]}
                      placeholder={pt ? 'Selecione o time…' : 'Select team…'}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Select
                      value={r.role}
                      onChange={v => updateRow(i, { role: v as 'manager' | 'user' })}
                      options={[
                        { value: 'user', label: 'user' },
                        ...(viewerIsOwner ? [{ value: 'manager', label: 'manager' }] : []),
                      ]}
                    />
                  </div>
                  <button type="button" onClick={() => removeRow(i)} disabled={rows.length === 1}
                    style={{ ...trashBtn, opacity: rows.length === 1 ? 0.35 : 1, cursor: rows.length === 1 ? 'not-allowed' : 'pointer' }}
                    aria-label={pt ? 'Remover time' : 'Remove team'}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* MACHINES SECTION */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 18, marginTop: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14 }}>
            {pt ? 'Máquinas' : 'Machines'}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>{pt ? 'Vincular máquinas' : 'Link machines'}</span>
              <button type="button" style={ghostBtn} onClick={addMachineRow}><Plus size={13} /> {pt ? 'Adicionar' : 'Add'}</button>
            </div>
            {machineRows.length === 0 ? (
              <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', padding: '12px 0' }}>
                {pt ? 'Nenhuma máquina a ser vinculada.' : 'No machines to link.'}
              </div>
            ) : (
              <>
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5, margin: 0 }}>
                  {pt
                    ? 'Tokens gerados aparecerão apenas uma vez após a criação.'
                    : 'Tokens will be shown only once after creation.'}
                </p>
                {machineRows.map((m, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                    <Field label={pt ? 'Nome da máquina' : 'Machine name'}>
                      <input style={input} value={m.name} onChange={e => updateMachineRow(i, { name: e.target.value })} placeholder={pt ? 'ex.: laptop-trabalho' : 'e.g. work-laptop'} />
                    </Field>
                    {accountType === 'member' && (
                      <Field label={pt ? 'Time (opcional)' : 'Team (optional)'}>
                        <Select
                          value={m.teamId}
                          onChange={v => updateMachineRow(i, { teamId: v })}
                          options={[
                            { value: '', label: pt ? 'Deixar vazio' : 'Leave empty' },
                            ...assignableTeams.map(t => ({ value: t._id, label: t.name })),
                          ]}
                          placeholder={pt ? 'Deixar vazio' : 'Leave empty'}
                        />
                      </Field>
                    )}
                    <button type="button" onClick={() => removeMachineRow(i)}
                      style={trashBtn}
                      aria-label={pt ? 'Remover máquina' : 'Remove machine'}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
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
            {created.machineTokens && created.machineTokens.length > 0 && created.machineTokens.map(mt => (
              <React.Fragment key={mt.name}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 8 }}>
                  {pt ? 'Máquina:' : 'Machine:'} {mt.name}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {pt ? 'Token' : 'Token'}
                  </span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <code style={{ flex: 1, fontSize: 11.5, fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', wordBreak: 'break-all', color: 'var(--text-primary)' }}>{mt.token}</code>
                    <button type="button" style={ghostBtn} onClick={e => { e.stopPropagation(); void copy(`token-${mt.name}`, mt.token) }} aria-label="Copy token">
                      {copied === `token-${mt.name}` ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                  {copyFailed === `token-${mt.name}` && (
                    <span style={{ fontSize: 10, color: '#ef4444', lineHeight: 1.4 }}>
                      {pt ? 'falha ao copiar — selecione manualmente' : 'copy failed — select manually'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {pt ? 'Comando de conexão' : 'Connect command'}
                  </span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <code style={{ flex: 1, fontSize: 11.5, fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', wordBreak: 'break-all', color: 'var(--text-secondary)' }}>
                      {connectCmdFor(mt.token)}
                    </code>
                    <button type="button" style={ghostBtn} onClick={e => { e.stopPropagation(); void copy(`cmd-${mt.name}`, connectCmdFor(mt.token)) }} aria-label="Copy connect command">
                      {copied === `cmd-${mt.name}` ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                  {copyFailed === `cmd-${mt.name}` && (
                    <span style={{ fontSize: 10, color: '#ef4444', lineHeight: 1.4 }}>
                      {pt ? 'falha ao copiar — selecione manualmente' : 'copy failed — select manually'}
                    </span>
                  )}
                </div>
              </React.Fragment>
            ))}
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

      {/* Edit account drawer — while a shown-once temp password or machine token is on screen, backdrop/X are no-ops
          so it can't be lost to a stray click (Close/Save are explicit). */}
      <Drawer open={editOpen} onClose={() => { if (!tempPassword && !addedMachineToken) setEditOpen(false) }} title={pt ? 'Editar conta' : 'Edit account'}>
        {drawerErr(editErr)}

        {/* IDENTITY SECTION (read-first) */}
        <Section
          title={pt ? 'Identidade' : 'Identity'}
          editing={editingSection === 'identity'}
          canEdit={canEditEdit}
          onEdit={() => { setEditErr(null); setEn(editAccount?.name ?? ''); setEditingSection('identity') }}
          onCancel={() => { setEn(editAccount?.name ?? ''); setEditingSection(null) }}
          onSave={() => void saveIdentity()}
          labels={sectionLabels}
          editChildren={
            <>
              <Field label={pt ? 'Nome' : 'Name'}>
                <input style={input} value={en} onChange={e => setEn(e.target.value)} placeholder={pt ? 'Nome completo' : 'Full name'} />
              </Field>
              <ReadField label="Email" value={editAccount?.email ?? '—'} />
            </>
          }
        >
          {(() => {
            const managerTeamNames = editAccount ? editAccount.memberships.filter(m => m.role === 'manager').map(m => teamNameOf(m.teamId)) : []
            const roleKind = editIsOwner ? 'owner' : managerTeamNames.length > 0 ? 'manager' : 'user'
            const line = editIsOwner
              ? (pt ? 'Acesso total ao painel central.' : 'Full access to the central dashboard.')
              : roleKind === 'manager'
                ? (pt ? `Gerente de ${managerTeamNames.join(', ')}.` : `Manager of ${managerTeamNames.join(', ')}.`)
                : (pt ? 'Leitura restrita aos times atribuídos.' : 'Scoped read of assigned teams.')
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <RoleBadge role={roleKind} />
                  <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{line}</span>
                </div>
                <ReadField label={pt ? 'Nome' : 'Name'} value={editAccount?.name ?? '—'} />
                <ReadField label="Email" value={editAccount?.email ?? '—'} />
              </div>
            )
          })()}
        </Section>

        {/* ACCESS (TEAMS) SECTION (read-first; owners have no team scope) */}
        <Section
          title={pt ? 'Acesso (times)' : 'Access (teams)'}
          editing={editingSection === 'teams'}
          canEdit={canEditEdit && !editIsOwner}
          onEdit={() => {
            setEditErr(null)
            setERows(editAccount && editAccount.memberships.length ? editAccount.memberships.map(m => ({ ...m })) : [{ teamId: '', role: 'user' }])
            setEditingSection('teams')
          }}
          onCancel={() => {
            setERows(editAccount && editAccount.memberships.length ? editAccount.memberships.map(m => ({ ...m })) : [{ teamId: '', role: 'user' }])
            setEditingSection(null)
          }}
          onSave={() => void saveTeams()}
          labels={sectionLabels}
          editChildren={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>{pt ? 'Escopo (times)' : 'Scope (teams)'}</span>
                <button type="button" style={ghostBtn} onClick={addERow}><Plus size={13} /> {pt ? 'Adicionar time' : 'Add team'}</button>
              </div>
              {eRows.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div style={{ flex: 2 }}>
                    <Select
                      value={r.teamId}
                      onChange={v => updateERow(i, { teamId: v })}
                      options={[
                        { value: '', label: pt ? 'Selecione o time…' : 'Select team…' },
                        ...assignableTeams.map(t => ({ value: t._id, label: t.name })),
                      ]}
                      placeholder={pt ? 'Selecione o time…' : 'Select team…'}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Select
                      value={r.role}
                      onChange={v => updateERow(i, { role: v as 'manager' | 'user' })}
                      options={[
                        { value: 'user', label: 'user' },
                        ...(viewerIsOwner ? [{ value: 'manager', label: 'manager' }] : []),
                      ]}
                    />
                  </div>
                  <button type="button" onClick={() => removeERow(i)} disabled={eRows.length === 1}
                    style={{ ...trashBtn, opacity: eRows.length === 1 ? 0.35 : 1, cursor: eRows.length === 1 ? 'not-allowed' : 'pointer' }}
                    aria-label={pt ? 'Remover time' : 'Remove team'}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          }
        >
          {editIsOwner ? (
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '9px 11px' }}>
              {pt ? 'Owners não têm escopo de times.' : 'Owners have no team scope.'}
            </div>
          ) : (editAccount && editAccount.memberships.length > 0) ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {editAccount.memberships.map(m => (
                <span key={m.teamId} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 6, fontSize: 11.5,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                }}>
                  {teamNameOf(m.teamId)} <RoleBadge role={m.role} />
                </span>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>—</span>
          )}
        </Section>

        {/* MACHINES SECTION (read-first; add/rename/revoke behind the section's Edit toggle) */}
        <Section
          title={pt ? 'Máquinas' : 'Machines'}
          editing={editingSection === 'machines'}
          canEdit={canEditEdit}
          onEdit={() => { setEditErr(null); setEditingSection('machines') }}
          onCancel={() => { setAddMachineName(''); setAddMachineTeam(''); setRenamingMachineId(null); setRenameMachineValue(''); setEditingSection(null) }}
          onSave={() => { setAddMachineName(''); setAddMachineTeam(''); setRenamingMachineId(null); setRenameMachineValue(''); setEditingSection(null) }}
          labels={sectionLabels}
          editChildren={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>{pt ? 'Máquinas vinculadas' : 'Linked machines'}</span>
              {loadingMachines ? (
                <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', padding: '12px 0' }}>{pt ? 'Carregando…' : 'Loading…'}</div>
              ) : linkedMachines.length === 0 ? (
                <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', padding: '12px 0' }}>{pt ? 'Nenhuma máquina vinculada.' : 'No machines linked.'}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {linkedMachines.map(m => {
                    const isRenamingThisMachine = renamingMachineId === m.id
                    return (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 7 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                          {isRenamingThisMachine ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input
                                type="text"
                                value={renameMachineValue}
                                onChange={e => setRenameMachineValue(e.target.value)}
                                onKeyDown={handleRenameMachineKeyDown}
                                autoFocus
                                style={{
                                  ...input,
                                  padding: '4px 8px',
                                  fontSize: 12.5,
                                  minWidth: 120,
                                  flex: 1,
                                }}
                              />
                              <button
                                onClick={confirmRenameMachine}
                                style={{ ...ghostBtn, padding: '4px 8px', border: 'none', color: '#10b981' }}
                                title={pt ? 'Confirmar' : 'Confirm'}
                              >
                                <Check size={14} />
                              </button>
                              <button
                                onClick={cancelRenameMachine}
                                style={{ ...ghostBtn, padding: '4px 8px', border: 'none', color: '#6b7280' }}
                                title={pt ? 'Cancelar' : 'Cancel'}
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ) : (
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{m.machineName}</span>
                          )}
                          {!isRenamingThisMachine && (
                            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                              {m.teamId ? teamNameOf(m.teamId) : (pt ? 'sem time' : 'no team')} · {m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleString() : (pt ? 'nunca' : 'never')}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            style={{ ...ghostBtn, padding: '5px 10px', fontSize: 11.5 }}
                            onClick={() => startRenameMachine(m.id, m.machineName)}
                            title={pt ? 'Renomear' : 'Rename'}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            style={{ ...ghostBtn, padding: '5px 10px', color: '#ef4444', fontSize: 11.5 }}
                            onClick={() => window.confirm(pt ? 'Revogar esta máquina?' : 'Revoke this machine?') && void revokeMachine(m.id)}
                          >
                            {pt ? 'Revogar' : 'Revoke'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {/* Add machine inline form */}
              {addedMachineToken ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--anthropic-orange)', borderRadius: 7 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {pt ? 'Máquina adicionada — copie agora' : 'Machine added — copy now'}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
                    {addedMachineName}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {pt ? 'Token' : 'Token'}
                    </span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <code style={{ flex: 1, fontSize: 11.5, fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', wordBreak: 'break-all', color: 'var(--text-primary)' }}>{addedMachineToken}</code>
                      <button type="button" style={ghostBtn} onClick={e => { e.stopPropagation(); void copy('added-token', addedMachineToken) }} aria-label="Copy token">
                        {copied === 'added-token' ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                    </div>
                    {copyFailed === 'added-token' && (
                      <span style={{ fontSize: 10, color: '#ef4444', lineHeight: 1.4 }}>
                        {pt ? 'falha ao copiar — selecione manualmente' : 'copy failed — select manually'}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {pt ? 'Comando de conexão' : 'Connect command'}
                    </span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <code style={{ flex: 1, fontSize: 11.5, fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', wordBreak: 'break-all', color: 'var(--text-secondary)' }}>
                        {connectCmdFor(addedMachineToken)}
                      </code>
                      <button type="button" style={ghostBtn} onClick={e => { e.stopPropagation(); void copy('added-cmd', connectCmdFor(addedMachineToken)) }} aria-label="Copy connect command">
                        {copied === 'added-cmd' ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                    </div>
                    {copyFailed === 'added-cmd' && (
                      <span style={{ fontSize: 10, color: '#ef4444', lineHeight: 1.4 }}>
                        {pt ? 'falha ao copiar — selecione manualmente' : 'copy failed — select manually'}
                      </span>
                    )}
                  </div>
                  <button type="button" style={ghostBtn} onClick={() => setAddedMachineToken(null)}>{pt ? 'Fechar' : 'Close'}</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                  <Field label={pt ? 'Nome da máquina' : 'Machine name'}>
                    <input style={input} value={addMachineName} onChange={e => setAddMachineName(e.target.value)} placeholder={pt ? 'ex.: laptop-trabalho' : 'e.g. work-laptop'} />
                  </Field>
                  {!editIsOwner && (
                    <Field label={pt ? 'Time (opcional)' : 'Team (optional)'}>
                      <Select
                        value={addMachineTeam}
                        onChange={v => setAddMachineTeam(v)}
                        options={[
                          { value: '', label: pt ? 'Deixar vazio' : 'Leave empty' },
                          ...assignableTeams.map(t => ({ value: t._id, label: t.name })),
                        ]}
                        placeholder={pt ? 'Deixar vazio' : 'Leave empty'}
                      />
                    </Field>
                  )}
                  <button type="button" style={primaryBtn} onClick={() => void addMachine()}>
                    <Plus size={13} /> {pt ? 'Adicionar' : 'Add'}
                  </button>
                </div>
              )}
            </div>
          }
        >
          {loadingMachines ? (
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', padding: '12px 0' }}>{pt ? 'Carregando…' : 'Loading…'}</div>
          ) : linkedMachines.length === 0 ? (
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', padding: '12px 0' }}>{pt ? 'Nenhuma máquina vinculada.' : 'No machines linked.'}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {linkedMachines.map(m => (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 7 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{m.machineName}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {m.teamId ? teamNameOf(m.teamId) : (pt ? 'sem time' : 'no team')} · {m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleString() : (pt ? 'nunca' : 'never')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button style={ghostBtn} onClick={() => setEditOpen(false)}>{pt ? 'Fechar' : 'Close'}</button>
        </div>
      </Drawer>
    </div>
  )
}
