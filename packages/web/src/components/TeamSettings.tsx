import React, { useState, useEffect, useRef } from 'react'
import { Loader2, CheckCircle, XCircle, Users, User, Server, LogOut } from 'lucide-react'
import { TeamMembers } from './TeamMembers'
import { PUSH_INTERVAL, type TeamConfig } from '@agentistics/core'

// ── Types ──────────────────────────────────────────────────────────────────

// TeamConfig is imported from @agentistics/core — single source of truth.
export type { TeamConfig }

// Interval options shown in the selectors.
// Must stay in sync with PUSH_INTERVAL.MIN_SEC / PUSH_INTERVAL.MAX_SEC.
// Values outside [MIN_SEC, MAX_SEC] are filtered out at definition time so
// raising MIN_SEC automatically drops invalid options from the member list.
const INTERVAL_OPTIONS = ([15, 30, 60, 120, 300] as const).filter(
  (sec) => sec >= PUSH_INTERVAL.MIN_SEC && sec <= PUSH_INTERVAL.MAX_SEC,
) as readonly number[]
// Express mode reveals sub-15s options (down to EXPRESS_MIN_SEC) — central-only.
const EXPRESS_OPTIONS = ([5, 10, ...INTERVAL_OPTIONS] as const).filter(
  (sec) => sec >= PUSH_INTERVAL.EXPRESS_MIN_SEC && sec <= PUSH_INTERVAL.MAX_SEC,
) as readonly number[]

export interface Props {
  team: TeamConfig
  onChange: (team: TeamConfig) => void
  lang: 'pt' | 'en'
  /** When true, this instance is the team central — show admin panel, hide member connect fields */
  central: boolean | null
}

interface TestResult {
  ok: boolean
  status: number
  error?: string
  user?: string
  org?: string
}

// ── i18n ──────────────────────────────────────────────────────────────────

const COPY = {
  mode:              { en: 'Mode',                         pt: 'Modo' },
  solo:              { en: 'Solo',                         pt: 'Solo' },
  member:            { en: 'Join central',                 pt: 'Entrar na central' },
  serverUrl:         { en: 'Server URL',                   pt: 'URL do servidor' },
  serverUrlSub:      { en: 'Base URL of the central agentistics instance (no trailing slash)', pt: 'URL base da instância central do agentistics (sem barra final)' },
  yourName:          { en: 'Display name',                 pt: 'Nome de exibição' },
  yourNameSub:       { en: 'How you appear on the team dashboard. With a per-member token the central sets this for you.', pt: 'Como você aparece no dashboard do time. Com um token por membro, a central define isso por você.' },
  leaveCentral:      { en: 'Leave central',                pt: 'Sair da central' },
  leaving:           { en: 'Leaving…',                     pt: 'Saindo…' },
  leaveConfirm:      { en: 'Leave & delete my data on the central?', pt: 'Sair e apagar meus dados na central?' },
  leftOk:            { en: 'Left the central',             pt: 'Saiu da central' },
  cancel:            { en: 'Cancel',                       pt: 'Cancelar' },
  org:               { en: 'Organization',                 pt: 'Organização' },
  orgSub:            { en: "Namespace for this member's data on the central server", pt: 'Namespace dos dados deste membro no servidor central' },
  token:             { en: 'Bearer token',                 pt: 'Token de acesso' },
  tokenSub:          { en: 'Matches TEAM_INGEST_TOKEN on the central server; leave blank if none', pt: 'Deve coincidir com TEAM_INGEST_TOKEN no servidor central; deixe em branco se não configurado' },
  testConnection:    { en: 'Test connection',              pt: 'Testar conexão' },
  testing:           { en: 'Testing…',                     pt: 'Testando…' },
  connected:         { en: 'Connected',                    pt: 'Conectado' },
  connFailed:        { en: 'Connection failed',            pt: 'Falha na conexão' },
  save:              { en: 'Save',                          pt: 'Salvar' },
  edit:              { en: 'Edit',                          pt: 'Editar' },
  saving:            { en: 'Saving…',                       pt: 'Salvando…' },
  pushNowOk:         { en: 'Connected — sent {n} sessions', pt: 'Conectado — {n} sessões enviadas' },
  pushNowErr:        { en: 'Connected but push failed',     pt: 'Conectado mas envio falhou' },
  whatIsPushed:      {
    en: 'Only computed session metrics (tokens, cost, duration) are pushed — no conversation content.',
    pt: 'Apenas métricas computadas (tokens, custo, duração) são enviadas — nenhum conteúdo de conversa.',
  },
  soloDesc: {
    en: 'All data stays local. No metrics are pushed anywhere.',
    pt: 'Todos os dados ficam locais. Nenhuma métrica é enviada.',
  },
  centralTitle: {
    en: 'Team central',
    pt: 'Central do time',
  },
  centralDesc: {
    en: 'This instance is running as the team central. Use the panel below to manage team members and their access tokens.',
    pt: 'Esta instância está rodando como central do time. Use o painel abaixo para gerenciar membros e seus tokens de acesso.',
  },
  machineTitle: {
    en: 'Machine mode',
    pt: 'Modo máquina',
  },
  machineDesc: {
    en: "This instance runs locally on your machine. Connect it to your team's central below to send your metrics.",
    pt: 'Esta instância roda localmente na sua máquina. Conecte-a ao central do seu time abaixo para enviar suas métricas.',
  },
  pushInterval:      { en: 'Push interval',                pt: 'Intervalo de envio' },
  express:           { en: 'Express',                      pt: 'Express' },
  expressHint:       { en: 'Allow intervals below 15 s (higher load on the central)', pt: 'Permite intervalos abaixo de 15 s (mais carga na central)' },
  intervalByCentral: { en: 'Set by your team\'s central — all members follow it.', pt: 'Definido pela central do time — todos os membros seguem.' },
  appearsAs:         { en: "You\'ll appear as:",             pt: 'Você aparece como:' },
  pushIntervalSubCentral: {
    en: 'Members push at this interval (min 15 s)',
    pt: 'Membros enviam neste intervalo (mín. 15 s)',
  },
  pushIntervalSubMember: {
    en: "Your team's central enforces a minimum; you can only push less often.",
    pt: 'O central do time exige um mínimo; você só pode enviar com menos frequência.',
  },
} satisfies Record<string, { en: string; pt: string }>

function c(key: keyof typeof COPY, lang: 'pt' | 'en'): string {
  return COPY[key][lang]
}

// ── Local primitives (mirrors PreferencesModal conventions) ───────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)',
      letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 14,
    }}>
      {label}
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '18px 0' }} />
}

function PrefRow({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </div>
  )
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        position: 'relative', width: 34, height: 20, borderRadius: 10,
        border: 'none', background: on ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
        cursor: 'pointer', padding: 0, transition: 'background 0.2s', flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: on ? 17 : 3,
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </button>
  )
}

function FieldInput({
  label, sub, value, onChange, type = 'text', placeholder, disabled,
}: {
  label: string
  sub?: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'password'
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 5 }}>{sub}</div>}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        readOnly={disabled}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '7px 10px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 7,
          fontSize: 13,
          fontFamily: type === 'password' ? 'inherit' : 'inherit',
          color: 'var(--text-primary)',
          outline: 'none',
          transition: 'border-color 0.15s',
          ...(disabled ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
        }}
        onFocus={e => { if (!disabled) e.currentTarget.style.borderColor = 'var(--anthropic-orange)' }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
      />
    </div>
  )
}

// ── Interval helpers ──────────────────────────────────────────────────────

function formatInterval(sec: number): string {
  if (sec < 60) return `${sec} s`
  const m = sec / 60
  return m === 1 ? '1 min' : `${m} min`
}

/**
 * A <select> that shows push-interval options.
 * @param minSec — options below this value are hidden (member mode)
 *                 or disabled (central mode uses disableBelow instead).
 * @param disableBelow — when true, renders all options but disables those < minSec
 */
function IntervalSelect({
  value,
  onChange,
  options = INTERVAL_OPTIONS,
  disabled = false,
}: {
  value: number
  onChange: (sec: number) => void
  options?: readonly number[]
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      disabled={disabled}
      style={{
        padding: '5px 8px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 7,
        fontSize: 12,
        color: 'var(--text-primary)',
        fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        outline: 'none',
        ...(disabled ? { opacity: 0.6 } : {}),
      }}
    >
      {options.map(sec => (
        <option key={sec} value={sec}>
          {formatInterval(sec)}
        </option>
      ))}
    </select>
  )
}

// ── Main component ────────────────────────────────────────────────────────

interface SaveResult {
  ok: boolean
  count?: number
  error?: string
}

export function TeamSettings({ team, onChange, lang, central }: Props) {
  const pt = lang === 'pt'
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  // ── Edit/lock state for the member connect form ──────────────────────────
  // Starts locked when already configured; starts open for fresh setup.
  const [editing, setEditing] = useState<boolean>(
    () => !(team.endpoint && team.token),
  )
  // Guard: if team config arrives asynchronously after mount (e.g. from parent),
  // lock the form once it becomes configured — but never fight the user after
  // they have manually toggled editing.
  const editingInitialized = useRef(false)
  // Tracks whether the USER has edited a field. An async config load (parent populating
  // the saved config) should lock the form; but the user TYPING the last field must NOT
  // flip it to locked before they get to click Save.
  const userTouched = useRef(false)
  useEffect(() => {
    if (editingInitialized.current || userTouched.current) return
    if (team.endpoint && team.token) {
      editingInitialized.current = true
      setEditing(false)
    }
  }, [team.endpoint, team.token])

  // ── Central push-interval state (loaded from /api/team/config) ──────────
  const [centralInterval, setCentralInterval] = useState<number>(PUSH_INTERVAL.DEFAULT_SEC)
  // Express mode: reveals sub-15s options. Derived from the loaded value (<15s ⇒ express).
  const [express, setExpress] = useState(false)
  const [intervalSaving, setIntervalSaving] = useState(false)
  const [intervalSaveErr, setIntervalSaveErr] = useState<string | null>(null)

  useEffect(() => {
    if (!central) return
    fetch('/api/team/config')
      .then(r => (r.ok ? (r.json() as Promise<{ pushIntervalSec?: number }>) : Promise.reject()))
      .then(cfg => {
        if (typeof cfg.pushIntervalSec === 'number') {
          const opts = cfg.pushIntervalSec < PUSH_INTERVAL.MIN_SEC ? EXPRESS_OPTIONS : INTERVAL_OPTIONS
          const val = opts.includes(cfg.pushIntervalSec) ? cfg.pushIntervalSec : PUSH_INTERVAL.DEFAULT_SEC
          setCentralInterval(val)
          if (cfg.pushIntervalSec < PUSH_INTERVAL.MIN_SEC) setExpress(true)
        }
      })
      .catch(() => { /* ignore — server may not have the field yet */ })
  }, [central])

  function handleCentralIntervalChange(sec: number) {
    const opts = express ? EXPRESS_OPTIONS : INTERVAL_OPTIONS
    const snapped = opts.includes(sec) ? sec : PUSH_INTERVAL.DEFAULT_SEC
    setCentralInterval(snapped)
    setIntervalSaving(true)
    setIntervalSaveErr(null)
    fetch('/api/team/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pushIntervalSec: snapped }),
    })
      .then(r => {
        if (!r.ok) throw new Error(`${r.status}`)
        setIntervalSaveErr(null)
      })
      .catch((err: unknown) => {
        setIntervalSaveErr(err instanceof Error ? err.message : 'Save failed')
      })
      .finally(() => { setIntervalSaving(false) })
  }

  function set<K extends keyof TeamConfig>(key: K, value: TeamConfig[K]) {
    userTouched.current = true // user is editing — don't let the async-load lock fire
    onChange({ ...team, [key]: value })
    // Clear test/save results when connection details change
    if (key === 'endpoint' || key === 'org' || key === 'user' || key === 'token') {
      setTestResult(null)
      setSaveResult(null)
    }
  }

  async function handleTestConnection() {
    if (testing) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/team/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: team.endpoint,
          token: team.token,
        }),
      })
      const data = (await res.json()) as TestResult
      setTestResult(data)
    } catch {
      setTestResult({ ok: false, status: 0, error: 'Network error' })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setSaveResult(null)
    setTestResult(null)
    try {
      // (a) Test connection + resolve identity from central
      const testRes = await fetch('/api/team/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: team.endpoint, token: team.token }),
      })
      const testData = (await testRes.json()) as TestResult
      setTestResult(testData)
      if (!testData.ok) {
        setSaveResult({ ok: false, error: testData.error ?? `Connection failed (${testData.status})` })
        return
      }

      // Identity: a per-member (minted) token resolves user+org from the central via whoami;
      // a shared TEAM_INGEST_TOKEN can't, so fall back to the self-declared name. org always
      // defaults to 'default' so the member never has to think about it.
      const resolvedUser = (testData.user ?? '').trim() || team.user.trim()
      const resolvedOrg  = (testData.org  ?? '').trim() || (team.org ?? '').trim() || 'default'
      if (!resolvedUser) {
        setSaveResult({ ok: false, error: pt ? 'Informe um nome de exibição' : 'Enter a display name' })
        return
      }
      const teamWithIdentity: typeof team = { ...team, mode: 'member', user: resolvedUser, org: resolvedOrg }

      // (b) Persist preferences with the central-resolved identity
      const putRes = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: teamWithIdentity }),
      })
      if (!putRes.ok) {
        setSaveResult({ ok: false, error: `Save failed (${putRes.status})` })
        return
      }
      onChange(teamWithIdentity)

      // (c) Push now
      const pushRes = await fetch('/api/team/push-now', { method: 'POST' })
      const pushData = (await pushRes.json()) as { ok: boolean; count?: number; error?: string }
      setSaveResult({ ok: pushData.ok, count: pushData.count, error: pushData.error })
      if (pushData.ok) {
        editingInitialized.current = true
        setEditing(false)
      }
    } catch (err) {
      setSaveResult({ ok: false, error: err instanceof Error ? err.message : 'Network error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleLeave() {
    if (leaving) return
    setConfirmLeave(false)
    setLeaving(true)
    setSaveResult(null)
    try {
      // (a) Ask the central to drop this member's data (best-effort — proxied so the token
      //     stays server-side). A failure here still lets us reset the local machine.
      await fetch('/api/team/leave-central', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: team.endpoint, token: team.token, org: team.org || 'default', user: team.user }),
      }).catch(() => { /* non-fatal */ })

      // (b) Reset the local config to solo and persist it (stops pushing).
      const solo: TeamConfig = { mode: 'solo', endpoint: '', org: 'default', user: '', token: '', pushIntervalSec: team.pushIntervalSec }
      await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: solo }),
      })
      onChange(solo)
      editingInitialized.current = false
      setEditing(true)
      // The mode visibly flips to Solo — that is the confirmation; clear any prior result.
      setSaveResult(null)
    } catch (err) {
      setSaveResult({ ok: false, error: err instanceof Error ? err.message : 'Network error' })
    } finally {
      setLeaving(false)
    }
  }

  // ── Central: null while /api/team/session is still in flight — show neutral placeholder ──
  if (central === null) {
    return <div style={{ minHeight: 80 }} />
  }

  // ── Central mode: show admin panel only ──────────────────────────────────
  if (central) {
    return (
      <div>
        {/* Central instance banner */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '12px 14px', borderRadius: 8, marginBottom: 20,
          background: 'var(--anthropic-orange-dim)',
          border: '1.5px solid var(--anthropic-orange)',
        }}>
          <Server size={16} style={{ color: 'var(--anthropic-orange)', flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--anthropic-orange)', marginBottom: 3 }}>
              {c('centralTitle', lang)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              {c('centralDesc', lang)}
            </div>
          </div>
        </div>

        {/* ── Push interval control (central admin) ── */}
        <SectionHeader label={pt ? 'Configurações de envio' : 'Push settings'} />
        <PrefRow
          label={c('pushInterval', lang)}
          sub={c('pushIntervalSubCentral', lang)}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IntervalSelect
              value={centralInterval}
              onChange={handleCentralIntervalChange}
              options={express ? EXPRESS_OPTIONS : INTERVAL_OPTIONS}
            />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }} title={c('expressHint', lang)}>
              <input
                type="checkbox"
                checked={express}
                onChange={e => {
                  const on = e.target.checked
                  setExpress(on)
                  // Leaving express with a sub-15s value → snap up to the normal floor and save.
                  if (!on && centralInterval < PUSH_INTERVAL.MIN_SEC) handleCentralIntervalChange(PUSH_INTERVAL.MIN_SEC)
                }}
                style={{ accentColor: 'var(--anthropic-orange)', cursor: 'pointer' }}
              />
              {c('express', lang)}
            </label>
            {intervalSaving && (
              <Loader2 size={12} style={{ color: 'var(--text-tertiary)', animation: 'spin 1s linear infinite' }} />
            )}
            {!intervalSaving && intervalSaveErr !== null && (
              <span style={{ fontSize: 11, color: '#ef4444' }}>{intervalSaveErr}</span>
            )}
          </div>
        </PrefRow>

        <Divider />

        <TeamMembers lang={lang} />

        {/* Inline keyframe for spinner */}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // ── Member / solo mode: show connect config ───────────────────────────────
  return (
    <div>
      {/* Machine mode banner — informational, blue/neutral styling */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '12px 14px', borderRadius: 8, marginBottom: 20,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
      }}>
        <User size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 3 }}>
            {c('machineTitle', lang)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.55 }}>
            {c('machineDesc', lang)}
          </div>
        </div>
      </div>

      {/* ── Mode selector ── */}
      <SectionHeader label={c('mode', lang)} />
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {(['solo', 'member'] as const).map(m => {
          const active = team.mode === m
          const Icon = m === 'solo' ? User : Users
          const label = m === 'solo' ? c('solo', lang) : c('member', lang)
          return (
            <button
              key={m}
              onClick={() => { if (editing) set('mode', m) }}
              disabled={!editing}
              style={{
                flex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                padding: '9px 14px', borderRadius: 8,
                border: active ? '1.5px solid var(--anthropic-orange)' : '1px solid var(--border)',
                background: active ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                color: active ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                fontSize: 13, fontWeight: active ? 700 : 500,
                cursor: editing ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
            >
              <Icon size={14} />
              {label}
            </button>
          )
        })}
      </div>

      {team.mode === 'solo' ? (
        <div style={{
          padding: '12px 14px', borderRadius: 8,
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6,
        }}>
          {c('soloDesc', lang)}
        </div>
      ) : (
        <>
          <Divider />

          {/* ── Connection fields ── */}
          <SectionHeader label={pt ? 'Conexão' : 'Connection'} />

          <FieldInput
            label={c('serverUrl', lang)}
            sub={c('serverUrlSub', lang)}
            value={team.endpoint}
            onChange={v => set('endpoint', v)}
            placeholder="https://central.example:47291"
            disabled={!editing}
          />

          <FieldInput
            label={c('token', lang)}
            sub={c('tokenSub', lang)}
            value={team.token}
            onChange={v => set('token', v)}
            type="password"
            placeholder="••••••••"
            disabled={!editing}
          />

          {/* Display name — self-declared (used with a shared TEAM_INGEST_TOKEN). When the
              token is a per-member minted token, the central resolves the name via whoami on
              Save and it overrides whatever is typed here. */}
          {editing && (
            <FieldInput
              label={c('yourName', lang)}
              sub={c('yourNameSub', lang)}
              value={team.user}
              onChange={v => set('user', v)}
              placeholder={pt ? 'Ex: Bryan Soares' : 'e.g. Bryan Soares'}
              disabled={!editing}
            />
          )}

          {/* Read-only identity resolved from the central via the bearer token */}
          {!editing && team.user && (
            <div style={{
              padding: '8px 12px', borderRadius: 7, marginBottom: 14,
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6,
            }}>
              {c('appearsAs', lang)}{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{team.user}</strong>
              {team.org && (
                <span style={{ color: 'var(--text-tertiary)' }}> · org: {team.org}</span>
              )}
            </div>
          )}

          {/* ── Push interval — read-only: the central is the sole authority ── */}
          <PrefRow
            label={c('pushInterval', lang)}
            sub={c('intervalByCentral', lang)}
          >
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              {pt ? 'definido pela central' : 'set by the central'}
            </span>
          </PrefRow>

          {/* ── Save / Edit button + result area ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            {editing ? (
              <button
                onClick={() => { void handleSave() }}
                disabled={saving || !team.endpoint}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 18px', borderRadius: 7, fontSize: 13, fontWeight: 700,
                  border: 'none',
                  background: saving || !team.endpoint ? 'var(--text-tertiary)' : 'var(--anthropic-orange)',
                  color: '#fff',
                  cursor: saving || !team.endpoint ? 'default' : 'pointer',
                  opacity: !team.endpoint ? 0.5 : 1,
                  fontFamily: 'inherit', transition: 'all 0.15s',
                }}
              >
                {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                {saving ? c('saving', lang) : c('save', lang)}
              </button>
            ) : (
              <>
                <button
                  onClick={() => setEditing(true)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 18px', borderRadius: 7, fontSize: 13, fontWeight: 700,
                    border: '1.5px solid var(--border)',
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit', transition: 'all 0.15s',
                  }}
                >
                  {c('edit', lang)}
                </button>
                {confirmLeave ? (
                  <>
                    <button
                      onClick={() => { void handleLeave() }}
                      disabled={leaving}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '7px 14px', borderRadius: 7, fontSize: 12.5, fontWeight: 700,
                        border: 'none', background: '#ef4444', color: '#fff',
                        cursor: leaving ? 'default' : 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {leaving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                      {leaving ? c('leaving', lang) : c('leaveConfirm', lang)}
                    </button>
                    <button
                      onClick={() => setConfirmLeave(false)}
                      disabled={leaving}
                      style={{
                        padding: '7px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 600,
                        border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                        color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {c('cancel', lang)}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmLeave(true)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '7px 14px', borderRadius: 7, fontSize: 12.5, fontWeight: 600,
                      border: '1px solid rgba(239,68,68,0.4)', background: 'transparent',
                      color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    <LogOut size={13} />
                    {c('leaveCentral', lang)}
                  </button>
                )}
              </>
            )}

            {saveResult !== null && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 12, fontWeight: 600,
                color: saveResult.ok ? 'var(--accent-green)' : '#ef4444',
              }}>
                {saveResult.ok
                  ? (
                    <><CheckCircle size={13} /> {c('pushNowOk', lang).replace('{n}', String(saveResult.count ?? 0))}</>
                  )
                  : (
                    <><XCircle size={13} /> {saveResult.error ?? c('pushNowErr', lang)}</>
                  )
                }
              </span>
            )}
          </div>

          {/* Info footer */}
          <div style={{
            padding: '10px 14px', borderRadius: 8,
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.6,
          }}>
            {c('whatIsPushed', lang)}
          </div>
        </>
      )}

      {/* Inline keyframe for spinner — injected once */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
