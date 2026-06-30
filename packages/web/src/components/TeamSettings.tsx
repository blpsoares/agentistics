import React, { useState, useEffect, useRef } from 'react'
import { Loader2, CheckCircle, XCircle, Users, User, Server } from 'lucide-react'
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
type IntervalSec = (typeof INTERVAL_OPTIONS)[number]

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
}

// ── i18n ──────────────────────────────────────────────────────────────────

const COPY = {
  mode:              { en: 'Mode',                         pt: 'Modo' },
  solo:              { en: 'Solo',                         pt: 'Solo' },
  member:            { en: 'Team member',                  pt: 'Membro do time' },
  serverUrl:         { en: 'Server URL',                   pt: 'URL do servidor' },
  serverUrlSub:      { en: 'Base URL of the central agentistics instance (no trailing slash)', pt: 'URL base da instância central do agentistics (sem barra final)' },
  yourName:          { en: 'Your name / email',            pt: 'Seu nome / e-mail' },
  yourNameSub:       { en: 'How this machine will appear in the team dashboard', pt: 'Como este computador aparece no dashboard do time' },
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
  minSec = PUSH_INTERVAL.MIN_SEC,
  disableBelow = false,
  disabled = false,
}: {
  value: number
  onChange: (sec: number) => void
  minSec?: number
  disableBelow?: boolean
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
      {(INTERVAL_OPTIONS as readonly number[]).filter(sec => disableBelow || sec >= minSec).map(sec => (
        <option key={sec} value={sec} disabled={disableBelow && sec < minSec}>
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

  // ── Edit/lock state for the member connect form ──────────────────────────
  // Starts locked when already configured; starts open for fresh setup.
  const [editing, setEditing] = useState<boolean>(
    () => !(team.endpoint && team.user && team.token),
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
    if (team.endpoint && team.user && team.token) {
      editingInitialized.current = true
      setEditing(false)
    }
  }, [team.endpoint, team.user, team.token])

  // ── Central push-interval state (loaded from /api/team/config) ──────────
  const [centralInterval, setCentralInterval] = useState<IntervalSec>(
    PUSH_INTERVAL.DEFAULT_SEC as IntervalSec,
  )
  const [intervalSaving, setIntervalSaving] = useState(false)
  const [intervalSaveErr, setIntervalSaveErr] = useState<string | null>(null)

  useEffect(() => {
    if (!central) return
    fetch('/api/team/config')
      .then(r => (r.ok ? (r.json() as Promise<{ pushIntervalSec?: number }>) : Promise.reject()))
      .then(cfg => {
        if (typeof cfg.pushIntervalSec === 'number') {
          // Snap to nearest option (or keep default if value is unusual)
          const nearest = (INTERVAL_OPTIONS as readonly number[]).includes(cfg.pushIntervalSec)
            ? (cfg.pushIntervalSec as IntervalSec)
            : (PUSH_INTERVAL.DEFAULT_SEC as IntervalSec)
          setCentralInterval(nearest)
        }
      })
      .catch(() => { /* ignore — server may not have the field yet */ })
  }, [central])

  function handleCentralIntervalChange(sec: number) {
    const snapped = (INTERVAL_OPTIONS as readonly number[]).includes(sec)
      ? (sec as IntervalSec)
      : (PUSH_INTERVAL.DEFAULT_SEC as IntervalSec)
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
          org: team.org,
          user: team.user,
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
      // (a) Persist preferences
      const putRes = await fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: { ...team, mode: 'member' } }),
      })
      if (!putRes.ok) {
        setSaveResult({ ok: false, error: `Save failed (${putRes.status})` })
        return
      }

      // (b) Test connection
      const testRes = await fetch('/api/team/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: team.endpoint, org: team.org, user: team.user, token: team.token }),
      })
      const testData = (await testRes.json()) as TestResult
      setTestResult(testData)
      if (!testData.ok) {
        setSaveResult({ ok: false, error: testData.error ?? `Connection failed (${testData.status})` })
        return
      }

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <IntervalSelect
              value={centralInterval}
              onChange={handleCentralIntervalChange}
              minSec={PUSH_INTERVAL.MIN_SEC}
              disableBelow
            />
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
            label={c('yourName', lang)}
            sub={c('yourNameSub', lang)}
            value={team.user}
            onChange={v => set('user', v)}
            placeholder="alice@example.com"
            disabled={!editing}
          />

          <FieldInput
            label={c('org', lang)}
            sub={c('orgSub', lang)}
            value={team.org}
            onChange={v => set('org', v)}
            placeholder="default"
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

          {/* ── Push interval (member) ── */}
          <PrefRow
            label={c('pushInterval', lang)}
            sub={c('pushIntervalSubMember', lang)}
          >
            <IntervalSelect
              value={team.pushIntervalSec ?? PUSH_INTERVAL.DEFAULT_SEC}
              onChange={sec => set('pushIntervalSec', sec)}
              minSec={PUSH_INTERVAL.MIN_SEC}
              disabled={!editing}
            />
          </PrefRow>

          {/* ── Save / Edit button + result area ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            {editing ? (
              <button
                onClick={() => { void handleSave() }}
                disabled={saving || !team.endpoint || !team.user}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 18px', borderRadius: 7, fontSize: 13, fontWeight: 700,
                  border: 'none',
                  background: saving || !team.endpoint || !team.user ? 'var(--text-tertiary)' : 'var(--anthropic-orange)',
                  color: '#fff',
                  cursor: saving || !team.endpoint || !team.user ? 'default' : 'pointer',
                  opacity: !team.endpoint || !team.user ? 0.5 : 1,
                  fontFamily: 'inherit', transition: 'all 0.15s',
                }}
              >
                {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                {saving ? c('saving', lang) : c('save', lang)}
              </button>
            ) : (
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
