import React, { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Plus, Copy, Check, RotateCw, Trash2 } from 'lucide-react'
import type { AppContext } from '../../lib/app-context'
import { TeamSettings, type TeamConfig } from '../../components/TeamSettings'
import { SectionHeader } from './primitives'
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
  const [machines, setMachines] = useState<MachineInfo[]>([])
  const [accounts, setAccounts] = useState<PublicAccount[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [err, setErr] = useState<string | null>(null)

  // Add machine drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [machineName, setMachineName] = useState('')
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [drawerErr, setDrawerErr] = useState<string | null>(null)
  const [created, setCreated] = useState<null | { token: string }>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState<string | null>(null)

  // Rotate state
  const [rotateId, setRotateId] = useState<string | null>(null)
  const [rotatedToken, setRotatedToken] = useState<string | null>(null)

  // Revoke confirm state
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null)

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
    } catch (e) {
      setErr(String(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

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
    setMachineName('')
    setSelectedTeamId('')
    setDrawerErr(null)
    setCreated(null)
    setCopied(null)
    setCopyFailed(null)
    setDrawerOpen(true)
  }

  async function addMachine() {
    if (!selectedAccountId.trim() || !machineName.trim()) {
      setDrawerErr(pt ? 'Informe a conta e o nome da máquina.' : 'Fill account and machine name.')
      return
    }
    const body: Record<string, unknown> = {
      accountId: selectedAccountId,
      name: machineName.trim(),
    }
    if (selectedTeamId) body.teamId = selectedTeamId
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
    setCreated({ token: d.token })
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

  // Determine whether to show the team picker for the selected account
  const selectedAccount = accounts.find(a => a.id === selectedAccountId)
  const showTeamPicker = selectedAccount?.role === 'member' && (selectedAccount.memberships.length ?? 0) > 1
  const membershipTeams = showTeamPicker
    ? selectedAccount!.memberships.map(m => ({ id: m.teamId, name: teamNameById.get(m.teamId) ?? m.teamId }))
    : []

  const connectCmd = created
    ? `agentop member connect --endpoint ${window.location.origin} --token ${created.token}`
    : ''

  const rotateConnectCmd = rotatedToken
    ? `agentop member connect --endpoint ${window.location.origin} --token ${rotatedToken}`
    : ''

  const drawerErrPanel = (m: string | null) => m && (
    <div style={{ fontSize: 12, color: '#ef4444', background: 'color-mix(in srgb, #ef4444 12%, transparent)', border: '1px solid color-mix(in srgb, #ef4444 35%, transparent)', borderRadius: 7, padding: '8px 10px' }}>
      {m}
    </div>
  )

  return (
    <>
      <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' }}>
        {pt
          ? 'Máquinas conectadas ao central — adicione tokens de máquina vinculados a contas.'
          : 'Machines connected to central — add machine tokens tied to accounts.'}
      </p>

      {err && <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 12 }}>{err}</div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{pt ? 'Máquinas' : 'Machines'}</div>
        <button style={primaryBtn} onClick={openDrawer}>
          <Plus size={14} /> {pt ? 'Adicionar máquina' : 'Add machine'}
        </button>
      </div>

      {machines.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', padding: '20px 0' }}>
          {pt ? 'Nenhuma máquina registrada.' : 'No machines registered.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
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
                return (
                  <tr key={m.id}>
                    <td style={{ ...td, fontWeight: 600, color: 'var(--text-primary)' }}>{m.machineName}</td>
                    <td style={td}>
                      {m.accountName ? (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 600 }}>{m.accountName}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{m.accountEmail}</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span>—</span>
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{pt ? 'sem conta' : 'no account'}</span>
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
      <Drawer open={drawerOpen} onClose={() => { if (!created) setDrawerOpen(false) }} title={pt ? 'Adicionar máquina' : 'Add machine'}>
        {drawerErrPanel(drawerErr)}

        {!created && (<>
          <Field label={pt ? 'Conta' : 'Account'}>
            <select style={input} value={selectedAccountId} onChange={e => { setSelectedAccountId(e.target.value); setSelectedTeamId('') }}>
              <option value="">{pt ? 'Selecione a conta…' : 'Select account…'}</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name} — {a.email}</option>
              ))}
            </select>
          </Field>

          <Field label={pt ? 'Nome da máquina' : 'Machine name'}>
            <input style={input} value={machineName} onChange={e => setMachineName(e.target.value)} placeholder={pt ? 'ex.: laptop-trabalho' : 'e.g. work-laptop'} />
          </Field>

          {showTeamPicker && (
            <Field label={pt ? 'Time (opcional)' : 'Team (optional)'}>
              <select style={input} value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)}>
                <option value="">{pt ? 'Deixar o servidor decidir' : 'Let server default'}</option>
                {membershipTeams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </Field>
          )}
        </>)}

        {created ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
              {pt ? 'Máquina criada — copie os dados agora' : 'Machine created — copy these now'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              {pt ? 'Estes valores não serão exibidos novamente.' : 'These values will not be shown again.'}
            </div>

            {/* Machine token */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {pt ? 'Token da máquina' : 'Machine token'}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <code style={{ flex: 1, fontSize: 11.5, fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
                  {created.token}
                </code>
                <button type="button" style={ghostBtn} onClick={e => { e.stopPropagation(); void copy('token', created.token) }} aria-label="Copy token">
                  {copied === 'token' ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
              {copyFailed === 'token' && (
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
