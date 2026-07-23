import React, { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Copy, Check, RotateCw, Trash2, Pencil, X } from 'lucide-react'
import type { AppContext } from '../../lib/app-context'
import { TeamSettings, type TeamConfig } from '../../components/TeamSettings'
import { SectionHeader, Select, Checkbox } from './primitives'
import { Drawer } from './Drawer'

// ── interfaces ────────────────────────────────────────────────────────────────
interface MachineInfo {
  id: string
  machineName: string
  user: string
  teamId?: string
  accountId?: string
  accountName?: string
  accountEmail?: string
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
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [machineRows, setMachineRows] = useState<{ name: string; teamId: string }[]>([{ name: '', teamId: '' }])
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

  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Owner edit state
  const [editingOwnerId, setEditingOwnerId] = useState<string | null>(null)

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
    setSelectedAccountId('')
    setMachineRows([{ name: '', teamId: '' }])
    setDrawerErr(null)
    setCreated(null)
    setCopied(null)
    setCopyFailed(null)
    setDrawerOpen(true)
  }

  function addMachineRow() {
    setMachineRows(rs => [...rs, { name: '', teamId: '' }])
  }

  function removeMachineRow(i: number) {
    setMachineRows(rs => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs)
  }

  function updateMachineRow(i: number, patch: { name?: string; teamId?: string }) {
    setMachineRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }

  async function addMachine() {
    if (!selectedAccountId.trim()) {
      setDrawerErr(pt ? 'Informe a conta.' : 'Select an account.')
      return
    }
    const validRows = machineRows.filter(r => r.name.trim())
    if (validRows.length === 0) {
      setDrawerErr(pt ? 'Informe ao menos um nome de máquina.' : 'Provide at least one machine name.')
      return
    }
    const results: { name: string; token: string }[] = []
    for (const row of validRows) {
      const body: Record<string, unknown> = {
        accountId: selectedAccountId,
        name: row.name.trim(),
      }
      if (row.teamId) body.teamId = row.teamId
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

  async function renameMachine(id: string, name: string) {
    try {
      const res = await fetch('/api/iam/machines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renameId: id, name }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setRenamingId(null)
      void load()
    } catch (e) {
      setErr(String(e))
    }
  }

  async function assignOwner(machineId: string, accountId: string) {
    try {
      const res = await fetch('/api/iam/machines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: machineId, accountId }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      void load()
    } catch (e) {
      setErr(String(e))
    }
  }

  function startRename(id: string, currentName: string) {
    setRenamingId(id)
    setRenameValue(currentName)
  }

  function cancelRename() {
    setRenamingId(null)
    setRenameValue('')
  }

  function confirmRename() {
    if (renamingId && renameValue.trim()) {
      void renameMachine(renamingId, renameValue.trim())
    }
  }

  function handleRenameKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      confirmRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelRename()
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

  // Determine whether to show the team picker for the selected account
  const selectedAccount = accounts.find(a => a.id === selectedAccountId)
  const showTeamPicker = selectedAccount?.role === 'member' && (selectedAccount.memberships.length ?? 0) > 1
  const membershipTeams = showTeamPicker
    ? selectedAccount!.memberships.map(m => ({ id: m.teamId, name: teamNameById.get(m.teamId) ?? m.teamId }))
    : []

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
                const isRenaming = renamingId === m.id
                return (
                  <tr key={m.id}>
                    <td style={td}>
                      <Checkbox
                        checked={selectedIds.has(m.id)}
                        onChange={() => toggleSelect(m.id)}
                        label=""
                      />
                    </td>
                    <td style={{ ...td, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {isRenaming ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="text"
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={handleRenameKeyDown}
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
                            onClick={confirmRename}
                            style={{ ...ghostBtn, padding: '4px 8px', border: 'none', color: '#10b981' }}
                            title={pt ? 'Confirmar' : 'Confirm'}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={cancelRename}
                            style={{ ...ghostBtn, padding: '4px 8px', border: 'none', color: '#6b7280' }}
                            title={pt ? 'Cancelar' : 'Cancel'}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        m.machineName
                      )}
                    </td>
                    <td style={td}>
                      {editingOwnerId === m.id && canManageFleet ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Select
                            value={m.accountId ?? ''}
                            onChange={v => {
                              void assignOwner(m.id, v)
                              setEditingOwnerId(null)
                            }}
                            options={[
                              { value: '', label: pt ? '— sem conta —' : '— no account —' },
                              ...accounts.map(a => ({ value: a.id, label: `${a.name} — ${a.email}` })),
                            ]}
                            placeholder={pt ? 'Selecionar conta…' : 'Select account…'}
                          />
                          <button
                            onClick={() => setEditingOwnerId(null)}
                            style={{ ...ghostBtn, padding: '4px 8px', border: 'none', color: '#6b7280' }}
                            title={pt ? 'Cancelar' : 'Cancel'}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {m.accountName ? (
                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                              <span style={{ fontWeight: 600 }}>{m.accountName}</span>
                              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{m.accountEmail}</span>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                              <span>—</span>
                              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{pt ? 'sem conta' : 'no account'}</span>
                            </div>
                          )}
                          {canManageFleet && (
                            <button
                              onClick={() => setEditingOwnerId(m.id)}
                              style={{ ...ghostBtn, padding: '4px 8px', border: 'none', color: 'var(--text-tertiary)' }}
                              title={pt ? 'Editar' : 'Edit'}
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={td}>{m.user}</td>
                    <td style={td}>{m.teamId ? (teamNameById.get(m.teamId) ?? m.teamId) : '—'}</td>
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
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          style={{ ...ghostBtn, padding: '4px 8px' }}
                          onClick={() => startRename(m.id, m.machineName)}
                          title={pt ? 'Renomear' : 'Rename'}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          style={{ ...ghostBtn, padding: '4px 8px' }}
                          onClick={() => void rotateMachine(m.id)}
                          title={pt ? 'Rotacionar token' : 'Rotate token'}
                        >
                          <RotateCw size={12} />
                        </button>
                        {revokeConfirmId === m.id ? (
                          <button
                            style={{ ...ghostBtn, padding: '4px 8px', color: '#ef4444', borderColor: '#ef4444' }}
                            onClick={() => void revokeMachine(m.id)}
                            title={pt ? 'Confirmar' : 'Confirm'}
                          >
                            {pt ? 'Confirmar?' : 'Confirm?'}
                          </button>
                        ) : (
                          <button
                            style={{ ...ghostBtn, padding: '4px 8px', color: '#ef4444' }}
                            onClick={() => setRevokeConfirmId(m.id)}
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
          <Field label={pt ? 'Conta' : 'Account'}>
            <Select
              value={selectedAccountId}
              onChange={v => { setSelectedAccountId(v) }}
              options={[
                { value: '', label: pt ? 'Selecione a conta…' : 'Select account…' },
                ...accounts.map(a => ({ value: a.id, label: `${a.name} — ${a.email}` })),
              ]}
              placeholder={pt ? 'Selecione a conta…' : 'Select account…'}
            />
          </Field>

          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 18, marginTop: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
                {pt ? 'Máquinas' : 'Machines'}
              </span>
              <button type="button" style={ghostBtn} onClick={addMachineRow}>
                <Plus size={13} /> {pt ? 'Adicionar outra máquina' : 'Add another machine'}
              </button>
            </div>

            {machineRows.map((row, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginBottom: 10 }}>
                <Field label={pt ? 'Nome da máquina' : 'Machine name'}>
                  <input
                    style={input}
                    value={row.name}
                    onChange={e => updateMachineRow(i, { name: e.target.value })}
                    placeholder={pt ? 'ex.: laptop-trabalho' : 'e.g. work-laptop'}
                  />
                </Field>

                {showTeamPicker && (
                  <Field label={pt ? 'Time (opcional)' : 'Team (optional)'}>
                    <Select
                      value={row.teamId}
                      onChange={v => updateMachineRow(i, { teamId: v })}
                      options={[
                        { value: '', label: pt ? 'Deixar vazio' : 'Leave empty' },
                        ...membershipTeams.map(t => ({ value: t.id, label: t.name })),
                      ]}
                      placeholder={pt ? 'Deixar vazio' : 'Leave empty'}
                    />
                  </Field>
                )}

                <button
                  type="button"
                  onClick={() => removeMachineRow(i)}
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
            ))}
          </div>
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
