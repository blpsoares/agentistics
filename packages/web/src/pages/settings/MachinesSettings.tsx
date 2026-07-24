import React, { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Copy, Check, RotateCw, Trash2, Pencil, X } from 'lucide-react'
import type { AppContext } from '../../lib/app-context'
import { TeamSettings, type TeamConfig } from '../../components/TeamSettings'
import { SectionHeader, Section, Select, Checkbox } from './primitives'
import { Drawer } from './Drawer'

// ── interfaces ────────────────────────────────────────────────────────────────
interface MachineInfo {
  id: string
  machineName: string
  user: string
  teamId?: string
  teamIds?: string[]
  accountId?: string
  accountIds?: string[]
  accountName?: string
  accountEmail?: string
  owners?: { id: string; name: string; email: string }[]
  createdAt: string
  lastSeenAt: string | null
  online?: boolean
  latencyMs?: number | null
}

interface PublicAccount {
  id: string
  name: string
  email: string
  role: 'owner' | 'member'
  memberships: { teamId: string; role: 'manager' | 'user' }[]
}

interface Team {
  _id: string
  name: string
}

// ── shared inline styles ──────────────────────────────────────────────────────
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

// ── solo/member fallback (unchanged) ──────────────────────────────────────────
const DEFAULT_TEAM_CONFIG: TeamConfig = {
  mode: 'solo',
  endpoint: '',
  org: 'default',
  user: '',
  token: '',
}

function SoloMemberMachinesView({ pt }: { pt: boolean }) {
  const [team, setTeam] = useState<TeamConfig>(DEFAULT_TEAM_CONFIG)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/preferences')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((prefs: { team?: Partial<TeamConfig> }) => {
        if (prefs.team) {
          setTeam({ ...DEFAULT_TEAM_CONFIG, ...prefs.team })
        }
      })
      .catch(err => { setLoadErr(err instanceof Error ? err.message : String(err)) })
  }, [])

  return (
    <>
      <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 18px' }}>
        {pt
          ? 'Máquinas de membros registradas — tokens, presença, rotação e revogação.'
          : 'Registered member machines — tokens, presence, rotate/revoke.'}
      </p>
      {loadErr ? (
        <div style={{
          padding: '10px 14px', borderRadius: 8,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
          fontSize: 12, color: '#ef4444',
        }}>
          {loadErr}
        </div>
      ) : (
        <TeamSettings team={team} onChange={setTeam} lang={pt ? 'pt' : 'en'} central={false} presence={undefined} />
      )}
    </>
  )
}

// ── central machines governance ───────────────────────────────────────────────
function CentralMachinesView({ pt }: { pt: boolean }) {
  const { me } = useOutletContext<AppContext>()
  const [machines, setMachines] = useState<MachineInfo[]>([])
  const [accounts, setAccounts] = useState<PublicAccount[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [err, setErr] = useState<string | null>(null)

  // Add machine drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [machineRows, setMachineRows] = useState<{ name: string; teamIds: string[]; accountIds: string[] }[]>([{ name: '', teamIds: [], accountIds: [] }])
  const [drawerErr, setDrawerErr] = useState<string | null>(null)
  const [created, setCreated] = useState<null | { machines: { name: string; token: string }[] }>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState<string | null>(null)

  // Rotate state
  const [rotateId, setRotateId] = useState<string | null>(null)
  const [rotatedToken, setRotatedToken] = useState<string | null>(null)

  // Revoke confirm state
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null)

  // Bulk delete state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)

  // Edit machine drawer state
  const [editMachineOpen, setEditMachineOpen] = useState(false)
  const [editingMachine, setEditingMachine] = useState<MachineInfo | null>(null)
  const [editName, setEditName] = useState('')
  const [editTeamIds, setEditTeamIds] = useState<string[]>([])
  const [editOwnerRows, setEditOwnerRows] = useState<string[]>([])
  const [editErr, setEditErr] = useState<string | null>(null)
  // Per-section edit toggle inside the (read-first) edit drawer. Only one section edits at a time.
  const [editingSection, setEditingSection] = useState<null | 'details' | 'owners'>(null)

  // Central URL state
  const [publicUrl, setPublicUrl] = useState('')
  const [publicUrlSaving, setPublicUrlSaving] = useState(false)
  const [publicUrlSaved, setPublicUrlSaved] = useState(false)
  const [publicUrlEditing, setPublicUrlEditing] = useState(false)

  const load = useCallback(async () => {
    try {
      const [m, a, t] = await Promise.all([
        fetch('/api/iam/machines').then(r => r.json() as Promise<{ machines: MachineInfo[] }>),
        fetch('/api/iam/accounts').then(r => r.json() as Promise<{ accounts: PublicAccount[] }>),
        fetch('/api/iam/teams').then(r => r.json() as Promise<{ teams: Team[] }>),
      ])
      setMachines(m.machines ?? [])
      setAccounts(a.accounts ?? [])
      setTeams(t.teams ?? [])
      setSelectedIds(new Set())
      setBulkDeleteConfirm(false)
    } catch (e) {
      setErr(String(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Load central config (public URL)
  useEffect(() => {
    fetch('/api/team/config')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((cfg: { publicUrl?: string }) => {
        if (typeof cfg.publicUrl === 'string') {
          setPublicUrl(cfg.publicUrl)
        }
      })
      .catch(() => { /* ignore — server may not have the field yet */ })
  }, [])

  async function savePublicUrl() {
    setPublicUrlSaving(true)
    setPublicUrlSaved(false)
    try {
      const res = await fetch('/api/team/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicUrl }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setPublicUrlSaved(true)
      setPublicUrlEditing(false)
      setTimeout(() => setPublicUrlSaved(false), 2000)
    } catch (e) {
      setErr(String(e))
    } finally {
      setPublicUrlSaving(false)
    }
  }

  // Build team lookup
  const teamNameById = new Map<string, string>()
  teams.forEach(t => teamNameById.set(t._id, t.name))

  // Resolve a machine's full team set (prefer teamIds, fall back to the single teamId).
  const machineTeamIds = (m: MachineInfo): string[] => m.teamIds ?? (m.teamId ? [m.teamId] : [])
  const teamNamesLabel = (ids: string[]): string =>
    ids.length === 0 ? '—' : ids.map(id => teamNameById.get(id) ?? id).join(', ')

  // copy helper (reused from UsersSettings)
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

  function openDrawer() {
    setMachineRows([{ name: '', teamIds: [], accountIds: [] }])
    setDrawerErr(null)
    setCreated(null)
    setCopied(null)
    setCopyFailed(null)
    setDrawerOpen(true)
  }

  function addMachineRow() {
    setMachineRows(rs => [...rs, { name: '', teamIds: [], accountIds: [] }])
  }

  function removeMachineRow(i: number) {
    setMachineRows(rs => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs)
  }

  function updateMachineRow(i: number, patch: { name?: string; teamIds?: string[]; accountIds?: string[] }) {
    setMachineRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }

  function addTeamToMachineRow(machineIdx: number) {
    setMachineRows(rs => rs.map((r, i) => i === machineIdx ? { ...r, teamIds: [...r.teamIds, ''] } : r))
  }

  function removeTeamFromMachineRow(machineIdx: number, teamIdx: number) {
    setMachineRows(rs => rs.map((r, i) => i === machineIdx ? { ...r, teamIds: r.teamIds.filter((_, idx) => idx !== teamIdx) } : r))
  }

  function updateTeamInMachineRow(machineIdx: number, teamIdx: number, teamId: string) {
    setMachineRows(rs => rs.map((r, i) => i === machineIdx ? { ...r, teamIds: r.teamIds.map((id, idx) => idx === teamIdx ? teamId : id) } : r))
  }

  function addOwnerToMachineRow(machineIdx: number) {
    setMachineRows(rs => rs.map((r, i) => i === machineIdx ? { ...r, accountIds: [...r.accountIds, ''] } : r))
  }

  function removeOwnerFromMachineRow(machineIdx: number, ownerIdx: number) {
    setMachineRows(rs => rs.map((r, i) => {
      if (i !== machineIdx) return r
      const newAccountIds = r.accountIds.filter((_, idx) => idx !== ownerIdx)
      return { ...r, accountIds: newAccountIds }
    }))
  }

  function updateOwnerInMachineRow(machineIdx: number, ownerIdx: number, accountId: string) {
    setMachineRows(rs => rs.map((r, i) => {
      if (i !== machineIdx) return r
      const newAccountIds = r.accountIds.map((id, idx) => idx === ownerIdx ? accountId : id)
      return { ...r, accountIds: newAccountIds }
    }))
  }

  async function addMachine() {
    const validRows = machineRows.filter(r => r.name.trim())
    if (validRows.length === 0) {
      setDrawerErr(pt ? 'Informe ao menos um nome de máquina.' : 'Provide at least one machine name.')
      return
    }
    // Non-owner must provide a team for every machine (scope enforcement).
    const isOwner = me?.role === 'owner'
    if (!isOwner) {
      const hasUnteamed = validRows.some(r => r.teamIds.filter(id => id.trim()).length === 0)
      if (hasUnteamed) {
        setDrawerErr(pt ? 'Selecione ao menos um time que você gerencia.' : 'Select at least one team you manage.')
        return
      }
    }
    const results: { name: string; token: string }[] = []
    for (const row of validRows) {
      const uniqueAccountIds = [...new Set(row.accountIds.filter(id => id.trim()))]
      const uniqueTeamIds = [...new Set(row.teamIds.filter(id => id.trim()))]
      const body: Record<string, unknown> = { name: row.name.trim() }
      if (uniqueAccountIds.length > 0) body.accountIds = uniqueAccountIds
      if (uniqueTeamIds.length > 0) body.teamIds = uniqueTeamIds
      const res = await fetch('/api/iam/machines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        setDrawerErr(d.error || `HTTP ${res.status}`)
        return
      }
      const d = await res.json() as { token: string }
      results.push({ name: row.name.trim(), token: d.token })
    }
    setCreated({ machines: results })
    void load()
  }

  async function revokeMachine(id: string) {
    try {
      const res = await fetch('/api/iam/machines', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setRevokeConfirmId(null)
      void load()
    } catch (e) {
      setErr(String(e))
    }
  }

  async function rotateMachine(id: string) {
    try {
      const res = await fetch('/api/iam/machines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotateId: id }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json() as { token: string }
      setRotateId(id)
      setRotatedToken(d.token)
      void load()
    } catch (e) {
      setErr(String(e))
    }
  }


  function openEditMachine(m: MachineInfo) {
    setEditingMachine(m)
    setEditName(m.machineName)
    setEditTeamIds(machineTeamIds(m))
    // Prefill owners from accountIds, or use accountId as fallback, or start with one empty row
    const ids = m.accountIds ?? (m.accountId ? [m.accountId] : [])
    setEditOwnerRows(ids.length > 0 ? ids : [''])
    setEditErr(null)
    setEditingSection(null)
    setEditMachineOpen(true)
  }

  function addEditOwnerRow() {
    setEditOwnerRows(rs => [...rs, ''])
  }

  function removeEditOwnerRow(i: number) {
    setEditOwnerRows(rs => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs)
  }

  function updateEditOwnerRow(i: number, accountId: string) {
    setEditOwnerRows(rs => rs.map((r, idx) => idx === i ? accountId : r))
  }

  function addEditTeamRow() {
    setEditTeamIds(rs => [...rs, ''])
  }

  function removeEditTeamRow(i: number) {
    setEditTeamIds(rs => rs.filter((_, idx) => idx !== i))
  }

  function updateEditTeamRow(i: number, teamId: string) {
    setEditTeamIds(rs => rs.map((r, idx) => idx === i ? teamId : r))
  }

  // Per-section saves (read-first drawer): each Section saves only its own fields.
  async function saveDetails() {
    if (!editingMachine) return
    if (!editName.trim()) {
      setEditErr(pt ? 'O nome não pode ficar vazio.' : 'Name cannot be empty.')
      return
    }
    const nameChanged = editName.trim() !== editingMachine.machineName
    const newTeamIds = [...new Set(editTeamIds.filter(id => id.trim()))]
    const originalTeamIds = machineTeamIds(editingMachine)
    const teamsChanged = JSON.stringify([...originalTeamIds].sort()) !== JSON.stringify([...newTeamIds].sort())
    try {
      if (nameChanged) {
        const res = await fetch('/api/iam/machines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ renameId: editingMachine.id, name: editName.trim() }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      }
      if (teamsChanged) {
        const res = await fetch('/api/iam/machines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reassignId: editingMachine.id, teamIds: newTeamIds }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      }
      setEditErr(null)
      setEditingSection(null)
      void load()
    } catch (e) {
      setEditErr(String(e))
    }
  }

  async function saveOwners() {
    if (!editingMachine) return
    const originalOwners = editingMachine.accountIds ?? (editingMachine.accountId ? [editingMachine.accountId] : [])
    const newOwners = [...new Set(editOwnerRows.filter(id => id.trim()))]
    const ownersChanged = JSON.stringify([...originalOwners].sort()) !== JSON.stringify([...newOwners].sort())
    try {
      if (ownersChanged) {
        const res = await fetch('/api/iam/machines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerId: editingMachine.id, accountIds: newOwners }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      }
      setEditErr(null)
      setEditingSection(null)
      void load()
    } catch (e) {
      setEditErr(String(e))
    }
  }

  function toggleSelectAll() {
    if (selectedIds.size === machines.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(machines.map(m => m.id)))
    }
  }

  function toggleSelect(id: string) {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setSelectedIds(newSet)
  }

  async function bulkDelete() {
    if (!bulkDeleteConfirm) {
      setBulkDeleteConfirm(true)
      return
    }
    try {
      for (const id of selectedIds) {
        const res = await fetch('/api/iam/machines', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      }
    } catch (e) {
      setErr(String(e))
    } finally {
      // Always resync — a partial failure otherwise leaves already-deleted rows on screen.
      setBulkDeleteConfirm(false)
      void load()
    }
  }

  // Team picker options: for owner viewers, all teams; for managers, only managed teams.
  const isOwner = me?.role === 'owner'
  const managerTeams = isOwner
    ? teams
    : teams.filter(t => me?.memberships.some(m => m.teamId === t._id && m.role === 'manager'))

  // Build connect commands based on token type (composite vs raw)
  const connectCmdFor = (token: string) => {
    const isComposite = token.startsWith('act1_')
    if (isComposite) {
      return `agentop member connect --token ${token}`
    }
    const endpoint = publicUrl || window.location.origin
    return `agentop member connect --endpoint ${endpoint} --token ${token}`
  }

  const rotateConnectCmd = rotatedToken ? connectCmdFor(rotatedToken) : ''

  const drawerErrPanel = (m: string | null) => m && (
    <div style={{ fontSize: 12, color: '#ef4444', background: 'color-mix(in srgb, #ef4444 12%, transparent)', border: '1px solid color-mix(in srgb, #ef4444 35%, transparent)', borderRadius: 7, padding: '8px 10px' }}>
      {m}
    </div>
  )

  const canManageFleet = me?.role === 'owner' || me?.memberships.some(m => m.role === 'manager')

  // Edit-drawer derived data (read-first sections). Re-derive the machine from the
  // fresh list by id so the read view reflects the latest data after a section save.
  const editMachine = editingMachine ? (machines.find(m => m.id === editingMachine.id) ?? editingMachine) : null
  const editCanManage = editMachine
    ? (canManageFleet || (editMachine.accountIds ?? (editMachine.accountId ? [editMachine.accountId] : [])).includes(me?.id ?? ''))
    : false
  const sectionLabels = {
    edit: pt ? 'Editar' : 'Edit',
    save: pt ? 'Salvar' : 'Save',
    cancel: pt ? 'Cancelar' : 'Cancel',
  }

  return (
    <>
      <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' }}>
        {pt
          ? 'Máquinas conectadas ao central — adicione tokens de máquina vinculados a contas.'
          : 'Machines connected to central — add machine tokens tied to accounts.'}
      </p>

      {err && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 12 }}>{err}</div>}

      {/* Central URL setting — only for owner/manager */}
      {canManageFleet && (
        <div style={{ marginBottom: 20, padding: '12px 14px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>
            {pt ? 'URL Central' : 'Central URL'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8, lineHeight: 1.5 }}>
            {pt
              ? 'Quando definida, o token gerado já embute esta URL — a máquina preenche o endpoint sozinha ao colar o token.'
              : 'When set, generated tokens embed this URL — the machine auto-fills the endpoint when the token is pasted.'}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!publicUrlEditing && publicUrl ? (
              <>
                <code style={{
                  flex: 1,
                  fontSize: 12.5,
                  fontFamily: 'var(--font-mono, monospace)',
                  color: 'var(--text-tertiary)',
                  padding: '9px 11px',
                }}>
                  {publicUrl}
                </code>
                <button
                  onClick={() => setPublicUrlEditing(true)}
                  style={{
                    ...ghostBtn,
                    padding: '8px 12px',
                    fontSize: 12,
                  }}
                  title={pt ? 'Editar' : 'Edit'}
                >
                  <Pencil size={14} />
                </button>
              </>
            ) : (
              <>
                <input
                  type="text"
                  value={publicUrl}
                  onChange={e => setPublicUrl(e.target.value)}
                  placeholder="http://100.109.247.39:48080"
                  style={{
                    ...input,
                    flex: 1,
                    fontSize: 12.5,
                  }}
                />
                {publicUrlEditing && (
                  <button
                    onClick={() => {
                      setPublicUrlEditing(false)
                      // Reload the original value (reset changes)
                      fetch('/api/team/config')
                        .then(r => r.ok ? r.json() : Promise.reject())
                        .then((cfg: { publicUrl?: string }) => {
                          if (typeof cfg.publicUrl === 'string') {
                            setPublicUrl(cfg.publicUrl)
                          }
                        })
                        .catch(() => { /* ignore */ })
                    }}
                    style={{
                      ...ghostBtn,
                      padding: '8px 16px',
                      fontSize: 12,
                    }}
                  >
                    {pt ? 'Cancelar' : 'Cancel'}
                  </button>
                )}
                <button
                  onClick={() => void savePublicUrl()}
                  disabled={publicUrlSaving}
                  style={{
                    ...primaryBtn,
                    padding: '8px 16px',
                    fontSize: 12,
                    opacity: publicUrlSaving ? 0.6 : 1,
                    cursor: publicUrlSaving ? 'default' : 'pointer',
                  }}
                >
                  {publicUrlSaving ? (pt ? 'Salvando…' : 'Saving…') : publicUrlSaved ? '✓' : (pt ? 'Salvar' : 'Save')}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{pt ? 'Máquinas' : 'Machines'}</div>
        {canManageFleet && (
          <button style={primaryBtn} onClick={openDrawer}>
            <Plus size={14} /> {pt ? 'Adicionar máquina' : 'Add machine'}
          </button>
        )}
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5, margin: '0 0 14px' }}>
        {pt
          ? 'Perdeu o token de uma máquina? Use Rotacionar para gerar um novo (o token só é exibido uma vez).'
          : 'Lost a machine\'s token? Use Rotate to generate a new one (tokens are shown only once).'}
      </p>

      {selectedIds.size > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button
            style={{
              ...primaryBtn,
              background: bulkDeleteConfirm ? '#ef4444' : 'color-mix(in srgb, #ef4444 12%, transparent)',
              borderColor: '#ef4444',
              color: bulkDeleteConfirm ? '#fff' : '#ef4444',
            }}
            onClick={() => void bulkDelete()}
          >
            <Trash2 size={14} />
            {bulkDeleteConfirm
              ? (pt ? `Confirmar exclusão de ${selectedIds.size}?` : `Confirm delete ${selectedIds.size}?`)
              : (pt ? `Excluir selecionados (${selectedIds.size})` : `Delete selected (${selectedIds.size})`)}
          </button>
        </div>
      )}

      {machines.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', padding: '20px 0' }}>
          {pt ? 'Nenhuma máquina registrada.' : 'No machines registered.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 40 }}>
                  <Checkbox
                    checked={selectedIds.size === machines.length}
                    onChange={toggleSelectAll}
                    label=""
                  />
                </th>
                <th style={th}>{pt ? 'Máquina' : 'Machine'}</th>
                <th style={th}>{pt ? 'Conta' : 'Owner'}</th>
                <th style={th}>{pt ? 'Usuário' : 'User'}</th>
                <th style={th}>{pt ? 'Time' : 'Team'}</th>
                <th style={th}>Status</th>
                <th style={th}>{pt ? 'Último acesso' : 'Last seen'}</th>
                <th style={th}>{pt ? 'Ações' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {machines.map(m => {
                const statusColor = m.online ? '#10b981' : '#6b7280'
                const statusLabel = m.online ? (pt ? 'online' : 'online') : (pt ? 'offline' : 'offline')
                // Determine if the viewer can manage this machine
                const ownerIds = m.accountIds ?? (m.accountId ? [m.accountId] : [])
                const canManage = canManageFleet || ownerIds.includes(me?.id ?? '')
                // Display owners
                const owners = m.owners ?? []
                const ownerDisplay = owners.length === 0 ? '—' : (owners[0]?.name ?? '') + (owners.length > 1 ? ` +${owners.length - 1}` : '')
                const ownerEmailDisplay = owners.length > 0 ? (owners[0]?.email ?? '') : (pt ? 'sem conta' : 'no account')
                return (
                  <tr key={m.id}
                    onClick={canManage ? () => openEditMachine(m) : undefined}
                    style={{ cursor: canManage ? 'pointer' : 'default' }}
                    onMouseEnter={canManage ? e => { e.currentTarget.style.background = 'var(--bg-elevated)' } : undefined}
                    onMouseLeave={canManage ? e => { e.currentTarget.style.background = '' } : undefined}>
                    <td style={td} onClick={e => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(m.id)}
                        onChange={() => toggleSelect(m.id)}
                        label=""
                      />
                    </td>
                    <td style={{ ...td, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {m.machineName}
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                        <span style={{ fontWeight: 600 }}>{ownerDisplay}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{ownerEmailDisplay}</span>
                      </div>
                    </td>
                    <td style={td}>{m.user}</td>
                    <td style={td}>
                      {(() => {
                        const ids = machineTeamIds(m)
                        if (ids.length === 0) return '—'
                        return (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {ids.map(id => (
                              <span key={id} style={{
                                display: 'inline-block', padding: '2px 7px', borderRadius: 999, fontSize: 11,
                                fontWeight: 600, color: 'var(--text-secondary)',
                                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                              }}>
                                {teamNameById.get(id) ?? id}
                              </span>
                            ))}
                          </div>
                        )
                      })()}
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
                        <span>{statusLabel}</span>
                        {m.latencyMs != null && <span style={{ color: 'var(--text-tertiary)' }}>· {m.latencyMs}ms</span>}
                      </div>
                    </td>
                    <td style={td}>
                      {m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleString() : (pt ? 'nunca' : 'never')}
                    </td>
                    <td style={td} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {canManage && (
                          <button
                            style={{ ...ghostBtn, padding: '4px 8px' }}
                            onClick={e => { e.stopPropagation(); openEditMachine(m) }}
                            title={pt ? 'Editar' : 'Edit'}
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                        <button
                          style={{ ...ghostBtn, padding: '4px 8px' }}
                          onClick={e => { e.stopPropagation(); void rotateMachine(m.id) }}
                          title={pt ? 'Rotacionar token' : 'Rotate token'}
                        >
                          <RotateCw size={12} />
                        </button>
                        {revokeConfirmId === m.id ? (
                          <button
                            style={{ ...ghostBtn, padding: '4px 8px', color: '#ef4444', borderColor: '#ef4444' }}
                            onClick={e => { e.stopPropagation(); void revokeMachine(m.id) }}
                            title={pt ? 'Confirmar' : 'Confirm'}
                          >
                            {pt ? 'Confirmar?' : 'Confirm?'}
                          </button>
                        ) : (
                          <button
                            style={{ ...ghostBtn, padding: '4px 8px', color: '#ef4444' }}
                            onClick={e => { e.stopPropagation(); setRevokeConfirmId(m.id) }}
                            title={pt ? 'Revogar' : 'Revoke'}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add machine drawer */}
      <Drawer open={drawerOpen} onClose={() => { if (!created) setDrawerOpen(false) }} title={pt ? 'Adicionar máquinas' : 'Add machines'}>
        {drawerErrPanel(drawerErr)}

        {!created && (<>
          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5, marginBottom: 14 }}>
            {pt
              ? 'Crie máquinas sem proprietário (loose), com time, com proprietário(s), ou ambos. Apenas o nome é obrigatório.'
              : 'Create machines with no owner (loose), team-only, owner(s)-only, or both. Only the name is required.'}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
              {pt ? 'Máquinas' : 'Machines'}
            </span>
            <button type="button" style={ghostBtn} onClick={addMachineRow}>
              <Plus size={13} /> {pt ? 'Adicionar outra máquina' : 'Add another machine'}
            </button>
          </div>

          {machineRows.map((row, machineIdx) => (
            <div key={machineIdx} style={{
              marginBottom: 20,
              padding: 12,
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'var(--bg-elevated)',
            }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginBottom: 12 }}>
                <Field label={pt ? 'Nome da máquina *' : 'Machine name *'}>
                  <input
                    style={input}
                    value={row.name}
                    onChange={e => updateMachineRow(machineIdx, { name: e.target.value })}
                    placeholder={pt ? 'ex.: laptop-trabalho' : 'e.g. work-laptop'}
                  />
                </Field>

                <button
                  type="button"
                  onClick={() => removeMachineRow(machineIdx)}
                  disabled={machineRows.length === 1}
                  style={{
                    ...trashBtn,
                    opacity: machineRows.length === 1 ? 0.35 : 1,
                    cursor: machineRows.length === 1 ? 'not-allowed' : 'pointer',
                  }}
                  aria-label={pt ? 'Remover máquina' : 'Remove machine'}
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Teams section */}
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {pt ? (isOwner ? 'Times (opcional)' : 'Times') : (isOwner ? 'Teams (optional)' : 'Teams')}
                  </span>
                  <button type="button" style={{ ...ghostBtn, padding: '4px 8px', fontSize: 11 }} onClick={() => addTeamToMachineRow(machineIdx)}>
                    <Plus size={11} /> {pt ? 'Adicionar' : 'Add'}
                  </button>
                </div>

                {row.teamIds.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                    {isOwner
                      ? (pt ? 'Sem time (loose) — clique "Adicionar" para vincular times.' : 'No team (loose) — click "Add" to link teams.')
                      : (pt ? 'Clique "Adicionar" para vincular ao menos um time.' : 'Click "Add" to link at least one team.')}
                  </div>
                ) : (
                  row.teamIds.map((teamId, teamIdx) => (
                    <div key={teamIdx} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ flex: 1 }}>
                        <Select
                          value={teamId}
                          onChange={v => updateTeamInMachineRow(machineIdx, teamIdx, v)}
                          options={[
                            { value: '', label: pt ? 'Selecione o time…' : 'Select team…' },
                            ...managerTeams.map(t => ({ value: t._id, label: t.name })),
                          ]}
                          placeholder={pt ? 'Selecione o time…' : 'Select team…'}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeTeamFromMachineRow(machineIdx, teamIdx)}
                        style={trashBtn}
                        aria-label={pt ? 'Remover time' : 'Remove team'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Owners section */}
              <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {pt ? 'Proprietários (opcional)' : 'Owners (optional)'}
                  </span>
                  <button type="button" style={{ ...ghostBtn, padding: '4px 8px', fontSize: 11 }} onClick={() => addOwnerToMachineRow(machineIdx)}>
                    <Plus size={11} /> {pt ? 'Adicionar' : 'Add'}
                  </button>
                </div>

                {row.accountIds.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                    {pt ? 'Sem proprietários — clique "Adicionar" para vincular contas.' : 'No owners — click "Add" to link accounts.'}
                  </div>
                ) : (
                  row.accountIds.map((accountId, ownerIdx) => (
                    <div key={ownerIdx} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ flex: 1 }}>
                        <Select
                          value={accountId}
                          onChange={v => updateOwnerInMachineRow(machineIdx, ownerIdx, v)}
                          options={[
                            { value: '', label: pt ? 'Selecione a conta…' : 'Select account…' },
                            // Owner accounts are already hidden from visibility — no need to filter again.
                            ...accounts.filter(a => a.role !== 'owner').map(a => ({ value: a.id, label: `${a.name} — ${a.email}` })),
                          ]}
                          placeholder={pt ? 'Selecione a conta…' : 'Select account…'}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeOwnerFromMachineRow(machineIdx, ownerIdx)}
                        style={trashBtn}
                        aria-label={pt ? 'Remover proprietário' : 'Remove owner'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </>)}

        {created ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
              {pt ? 'Máquinas criadas — copie os dados agora' : 'Machines created — copy these now'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {pt ? 'Estes valores não serão exibidos novamente.' : 'These values will not be shown again.'}
            </div>

            {created.machines.map((machine, idx) => (
              <React.Fragment key={idx}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginTop: idx > 0 ? 12 : 0 }}>
                  {pt ? 'Máquina:' : 'Machine:'} {machine.name}
                </div>

                {/* Machine token */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {pt ? 'Token' : 'Token'}
                  </span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <code style={{ flex: 1, fontSize: 11.5, fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
                      {machine.token}
                    </code>
                    <button type="button" style={ghostBtn} onClick={e => { e.stopPropagation(); void copy(`token-${idx}`, machine.token) }} aria-label="Copy token">
                      {copied === `token-${idx}` ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                  {copyFailed === `token-${idx}` && (
                    <span style={{ fontSize: 10, color: '#ef4444', lineHeight: 1.4 }}>
                      {pt ? 'falha ao copiar — selecione manualmente' : 'copy failed — select manually'}
                    </span>
                  )}
                </div>

                {/* Connect command */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {pt ? 'Comando de conexão' : 'Connect command'}
                  </span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <code style={{ flex: 1, fontSize: 11.5, fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', wordBreak: 'break-all', color: 'var(--text-secondary)' }}>
                      {connectCmdFor(machine.token)}
                    </code>
                    <button type="button" style={ghostBtn} onClick={e => { e.stopPropagation(); void copy(`connect-${idx}`, connectCmdFor(machine.token)) }} aria-label="Copy connect command">
                      {copied === `connect-${idx}` ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                  {copyFailed === `connect-${idx}` && (
                    <span style={{ fontSize: 10, color: '#ef4444', lineHeight: 1.4 }}>
                      {pt ? 'falha ao copiar — selecione manualmente' : 'copy failed — select manually'}
                    </span>
                  )}
                </div>
              </React.Fragment>
            ))}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button style={primaryBtn} onClick={() => setDrawerOpen(false)}>
                <Check size={14} /> {pt ? 'Concluir' : 'Done'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button style={ghostBtn} onClick={() => setDrawerOpen(false)}>{pt ? 'Cancelar' : 'Cancel'}</button>
            <button style={primaryBtn} onClick={() => void addMachine()}>
              <Plus size={14} /> {pt ? 'Adicionar' : 'Add'}
            </button>
          </div>
        )}
      </Drawer>

      {/* Rotate token drawer */}
      {rotateId && rotatedToken && (
        <Drawer open onClose={() => { setRotateId(null); setRotatedToken(null) }} title={pt ? 'Token rotacionado' : 'Token rotated'}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
              {pt ? 'Novo token — copie agora' : 'New token — copy now'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {pt ? 'Este valor não será exibido novamente.' : 'This value will not be shown again.'}
            </div>

            {/* Rotated token */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {pt ? 'Novo token' : 'New token'}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <code style={{ flex: 1, fontSize: 11.5, fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
                  {rotatedToken}
                </code>
                <button type="button" style={ghostBtn} onClick={e => { e.stopPropagation(); void copy('rotated-token', rotatedToken) }} aria-label="Copy token">
                  {copied === 'rotated-token' ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
              {copyFailed === 'rotated-token' && (
                <span style={{ fontSize: 10, color: '#ef4444', lineHeight: 1.4 }}>
                  {pt ? 'falha ao copiar — selecione manualmente' : 'copy failed — select manually'}
                </span>
              )}
            </div>

            {/* Connect command */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {pt ? 'Comando de conexão' : 'Connect command'}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <code style={{ flex: 1, fontSize: 11.5, fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', wordBreak: 'break-all', color: 'var(--text-secondary)' }}>
                  {rotateConnectCmd}
                </code>
                <button type="button" style={ghostBtn} onClick={e => { e.stopPropagation(); void copy('rotated-connect', rotateConnectCmd) }} aria-label="Copy connect command">
                  {copied === 'rotated-connect' ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
              {copyFailed === 'rotated-connect' && (
                <span style={{ fontSize: 10, color: '#ef4444', lineHeight: 1.4 }}>
                  {pt ? 'falha ao copiar — selecione manualmente' : 'copy failed — select manually'}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button style={primaryBtn} onClick={() => { setRotateId(null); setRotatedToken(null) }}>
                <Check size={14} /> {pt ? 'Concluir' : 'Done'}
              </button>
            </div>
          </div>
        </Drawer>
      )}

      {/* Edit machine drawer — read-first with a per-section Edit toggle. */}
      <Drawer open={editMachineOpen} onClose={() => setEditMachineOpen(false)} title={pt ? 'Editar máquina' : 'Edit machine'}>
        {drawerErrPanel(editErr)}

        {/* DETAILS SECTION (name + team) — read-first */}
        <Section
          title={pt ? 'Detalhes' : 'Details'}
          editing={editingSection === 'details'}
          canEdit={editCanManage}
          onEdit={() => {
            setEditErr(null)
            setEditName(editMachine?.machineName ?? '')
            setEditTeamIds(editMachine ? machineTeamIds(editMachine) : [])
            setEditingSection('details')
          }}
          onCancel={() => {
            setEditName(editMachine?.machineName ?? '')
            setEditTeamIds(editMachine ? machineTeamIds(editMachine) : [])
            setEditingSection(null)
          }}
          onSave={() => void saveDetails()}
          labels={sectionLabels}
          editChildren={
            <>
              <Field label={pt ? 'Nome da máquina' : 'Machine name'}>
                <input
                  style={input}
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder={pt ? 'ex.: laptop-trabalho' : 'e.g. work-laptop'}
                />
              </Field>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {pt ? 'Times' : 'Teams'}
                  </span>
                  <button type="button" style={{ ...ghostBtn, padding: '4px 8px', fontSize: 11 }} onClick={addEditTeamRow}>
                    <Plus size={11} /> {pt ? 'Adicionar time' : 'Add team'}
                  </button>
                </div>
                {editTeamIds.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                    {pt ? 'Sem time — clique "Adicionar time" para vincular.' : 'No teams — click "Add team" to link one.'}
                  </div>
                ) : (
                  editTeamIds.map((teamId, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <Select
                          value={teamId}
                          onChange={v => updateEditTeamRow(i, v)}
                          options={[
                            { value: '', label: pt ? 'Selecione o time…' : 'Select team…' },
                            ...teams.map(t => ({ value: t._id, label: t.name })),
                          ]}
                          placeholder={pt ? 'Selecione o time…' : 'Select team…'}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeEditTeamRow(i)}
                        style={trashBtn}
                        aria-label={pt ? 'Remover time' : 'Remove team'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ReadField label={pt ? 'Nome da máquina' : 'Machine name'} value={editMachine?.machineName ?? '—'} />
            <ReadField label={pt ? 'Times' : 'Teams'} value={editMachine ? teamNamesLabel(machineTeamIds(editMachine)) : '—'} />
          </div>
        </Section>

        {/* OWNERS SECTION — read-first */}
        <Section
          title={pt ? 'Contas (owners)' : 'Owners'}
          editing={editingSection === 'owners'}
          canEdit={editCanManage}
          onEdit={() => {
            setEditErr(null)
            const ids = editMachine?.accountIds ?? (editMachine?.accountId ? [editMachine.accountId] : [])
            setEditOwnerRows(ids.length > 0 ? ids : [''])
            setEditingSection('owners')
          }}
          onCancel={() => {
            const ids = editMachine?.accountIds ?? (editMachine?.accountId ? [editMachine.accountId] : [])
            setEditOwnerRows(ids.length > 0 ? ids : [''])
            setEditingSection(null)
          }}
          onSave={() => void saveOwners()}
          labels={sectionLabels}
          editChildren={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {pt ? 'Contas (owners)' : 'Owners'}
                </span>
                <button type="button" style={ghostBtn} onClick={addEditOwnerRow}>
                  <Plus size={13} /> {pt ? 'Adicionar conta' : 'Add owner'}
                </button>
              </div>
              {editOwnerRows.map((accountId, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <Select
                      value={accountId}
                      onChange={v => updateEditOwnerRow(i, v)}
                      options={[
                        { value: '', label: pt ? 'Selecione a conta…' : 'Select account…' },
                        ...accounts.map(a => ({ value: a.id, label: `${a.name} — ${a.email}` })),
                      ]}
                      placeholder={pt ? 'Selecione a conta…' : 'Select account…'}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeEditOwnerRow(i)}
                    disabled={editOwnerRows.length === 1}
                    style={{
                      ...trashBtn,
                      opacity: editOwnerRows.length === 1 ? 0.35 : 1,
                      cursor: editOwnerRows.length === 1 ? 'not-allowed' : 'pointer',
                    }}
                    aria-label={pt ? 'Remover conta' : 'Remove owner'}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          }
        >
          {(() => {
            const owners = editMachine?.owners ?? []
            if (owners.length === 0) {
              return <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{pt ? '— sem conta / loose' : '— no account / loose'}</span>
            }
            return (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {owners.map(o => (
                  <span key={o.id} style={{
                    display: 'inline-flex', flexDirection: 'column', gap: 1, padding: '5px 9px', borderRadius: 6,
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{o.name}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{o.email}</span>
                  </span>
                ))}
              </div>
            )
          })()}
        </Section>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button style={ghostBtn} onClick={() => setEditMachineOpen(false)}>{pt ? 'Fechar' : 'Close'}</button>
        </div>
      </Drawer>
    </>
  )
}

// ── main component ────────────────────────────────────────────────────────────
export default function MachinesSettings() {
  const ctx = useOutletContext<AppContext>()
  const pt = ctx.lang === 'pt'

  return (
    <div>
      <SectionHeader label={pt ? 'Máquinas' : 'Machines'} />
      {ctx.isCentral ? <CentralMachinesView pt={pt} /> : <SoloMemberMachinesView pt={pt} />}
    </div>
  )
}
