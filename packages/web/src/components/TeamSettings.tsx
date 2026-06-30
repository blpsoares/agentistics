import React, { useState } from 'react'
import { Loader2, CheckCircle, XCircle, Users, User, Server } from 'lucide-react'
import { TeamMembers } from './TeamMembers'

// ── Types ──────────────────────────────────────────────────────────────────

export interface TeamConfig {
  mode: 'solo' | 'member'
  endpoint: string
  org: string
  user: string
  pushEnabled: boolean
  token: string
}

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
  pushEnabled:       { en: 'Push enabled',                 pt: 'Envio ativo' },
  pushEnabledSub:    { en: 'Automatically sends consolidated session metrics to the central server every 60 s', pt: 'Envia automaticamente métricas consolidadas de sessão ao servidor central a cada 60 s' },
  testConnection:    { en: 'Test connection',              pt: 'Testar conexão' },
  testing:           { en: 'Testing…',                     pt: 'Testando…' },
  connected:         { en: 'Connected',                    pt: 'Conectado' },
  connFailed:        { en: 'Connection failed',            pt: 'Falha na conexão' },
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
  label, sub, value, onChange, type = 'text', placeholder,
}: {
  label: string
  sub?: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'password'
  placeholder?: string
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
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--anthropic-orange)' }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export function TeamSettings({ team, onChange, lang, central }: Props) {
  const pt = lang === 'pt'
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)

  function set<K extends keyof TeamConfig>(key: K, value: TeamConfig[K]) {
    onChange({ ...team, [key]: value })
    // Clear test result when connection details change
    if (key === 'endpoint' || key === 'org' || key === 'user' || key === 'token') {
      setTestResult(null)
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

        <TeamMembers lang={lang} />
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
              onClick={() => set('mode', m)}
              style={{
                flex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                padding: '9px 14px', borderRadius: 8,
                border: active ? '1.5px solid var(--anthropic-orange)' : '1px solid var(--border)',
                background: active ? 'var(--anthropic-orange-dim)' : 'var(--bg-elevated)',
                color: active ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                fontSize: 13, fontWeight: active ? 700 : 500,
                cursor: 'pointer', fontFamily: 'inherit',
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
          />

          <FieldInput
            label={c('yourName', lang)}
            sub={c('yourNameSub', lang)}
            value={team.user}
            onChange={v => set('user', v)}
            placeholder="alice@example.com"
          />

          <FieldInput
            label={c('org', lang)}
            sub={c('orgSub', lang)}
            value={team.org}
            onChange={v => set('org', v)}
            placeholder="default"
          />

          <FieldInput
            label={c('token', lang)}
            sub={c('tokenSub', lang)}
            value={team.token}
            onChange={v => set('token', v)}
            type="password"
            placeholder="••••••••"
          />

          {/* Test connection */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <button
              onClick={() => { void handleTestConnection() }}
              disabled={testing || !team.endpoint}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                border: '1px solid var(--border)',
                background: 'var(--bg-elevated)',
                color: testing || !team.endpoint ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                cursor: testing || !team.endpoint ? 'default' : 'pointer',
                opacity: !team.endpoint ? 0.5 : 1,
                fontFamily: 'inherit', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!testing && team.endpoint) e.currentTarget.style.color = 'var(--text-primary)' }}
              onMouseLeave={e => { if (!testing && team.endpoint) e.currentTarget.style.color = 'var(--text-secondary)' }}
            >
              {testing ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : null}
              {testing ? c('testing', lang) : c('testConnection', lang)}
            </button>

            {testResult !== null && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 12, fontWeight: 600,
                color: testResult.ok ? 'var(--accent-green)' : '#ef4444',
              }}>
                {testResult.ok
                  ? <><CheckCircle size={13} /> {c('connected', lang)}</>
                  : <><XCircle size={13} /> {c('connFailed', lang)}{testResult.error ? ` — ${testResult.error}` : testResult.status ? ` (${testResult.status})` : ''}</>
                }
              </span>
            )}
          </div>

          <Divider />

          {/* ── Push toggle ── */}
          <PrefRow
            label={c('pushEnabled', lang)}
            sub={c('pushEnabledSub', lang)}
          >
            <Toggle on={team.pushEnabled} onToggle={() => set('pushEnabled', !team.pushEnabled)} />
          </PrefRow>

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
