import React, { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  X, Clock, FileCode, GitCommit, Wrench, MessageSquare, Bot, Zap, AlertTriangle,
  CheckCircle, XCircle, Globe, Server, ExternalLink,
} from 'lucide-react'
import type { SessionMeta, Lang } from '../lib/types'
import { formatProjectName, formatModel, calcCost, getModelColor } from '../lib/types'
import { blendedCostPerToken } from '../hooks/useData'
import { fmtFull } from '../lib/format'
import { PrecisionToggle } from './PrecisionToggle'

interface Props {
  session: SessionMeta
  globalModelUsage: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>
  currency: 'USD' | 'BRL'
  brlRate: number
  lang: Lang
  onClose: () => void
}

function fmt(n: number, full = false): string {
  if (full) return fmtFull(n)
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtCost(usd: number, currency: 'USD' | 'BRL', rate: number): string {
  if (currency === 'BRL') {
    const brl = usd * rate
    if (brl < 0.005) return '<R$0,01'
    return `R$${brl.toFixed(2).replace('.', ',')}`
  }
  if (usd < 0.001) return '<USD 0.001'
  if (usd < 0.01) return `USD ${usd.toFixed(3)}`
  return `USD ${usd.toFixed(2)}`
}

function fmtDuration(minutes: number): string {
  if (minutes < 1) return '<1m'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtAgentDuration(ms: number): string {
  if (ms === 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`
}

function sessionCost(session: SessionMeta, globalModelUsage: Props['globalModelUsage']): number {
  // If the session has an explicit model, use exact pricing; else fallback to blended input/output
  if (session.model) {
    return calcCost(
      {
        inputTokens: session.input_tokens ?? 0,
        outputTokens: session.output_tokens ?? 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        costUSD: 0,
      },
      session.model,
    )
  }
  const blended = blendedCostPerToken(globalModelUsage)
  return ((session.input_tokens ?? 0) / 1_000_000) * blended.input
       + ((session.output_tokens ?? 0) / 1_000_000) * blended.output
}

export function SessionDrilldownModal({ session, globalModelUsage, currency, brlRate, lang, onClose }: Props) {
  const pt = lang === 'pt'
  const [fullPrecision, setFullPrecision] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const totalTokens = (session.input_tokens ?? 0) + (session.output_tokens ?? 0)
  const totalMessages = (session.user_message_count ?? 0) + (session.assistant_message_count ?? 0)
  const totalTools = Object.values(session.tool_counts ?? {}).reduce((a, b) => a + b, 0)
  const cost = sessionCost(session, globalModelUsage)

  // Hour distribution — build 0..23 buckets from message_hours
  const hourBuckets = Array.from({ length: 24 }, () => 0)
  for (const h of session.message_hours ?? []) {
    if (h >= 0 && h < 24) hourBuckets[h]!++
  }
  const maxHour = Math.max(...hourBuckets, 1)
  const activeHours = hourBuckets.filter(c => c > 0).length

  // Tool breakdown sorted by count
  const toolEntries = Object.entries(session.tool_counts ?? {})
    .sort((a, b) => b[1] - a[1])
  const maxToolCount = toolEntries[0]?.[1] ?? 1

  // Tool errors
  const toolErrorEntries = Object.entries(session.tool_error_categories ?? {})
    .sort((a, b) => b[1] - a[1])

  // Agent invocations
  const agentInvocations = session.agentMetrics?.invocations ?? []

  // Response time stats
  const responseTimes = session.user_response_times ?? []
  const avgResponse = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((s, n) => s + n, 0) / responseTimes.length)
    : null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 350,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          width: '100%',
          maxWidth: 980,
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{
          position: 'sticky',
          top: 0,
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--border)',
          padding: '18px 22px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          zIndex: 10,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                {pt ? 'Detalhes da sessão' : 'Session details'}
              </span>
              {session.model && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 999,
                  background: `${getModelColor(session.model)}22`,
                  color: getModelColor(session.model),
                  fontSize: 10, fontWeight: 600,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: getModelColor(session.model) }} />
                  {formatModel(session.model)}
                </span>
              )}
              {session._source && (
                <span style={{
                  padding: '2px 6px', borderRadius: 4,
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-tertiary)',
                  fontSize: 9, fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}>
                  {session._source}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'ui-monospace, monospace', marginBottom: 4 }}>
              {session.session_id}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span>{formatProjectName(session.project_path)}</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>{session.start_time ? format(parseISO(session.start_time), 'MMM d, yyyy HH:mm') : '—'}</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>{fmtDuration(session.duration_minutes ?? 0)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => {
                const isNay = session.project_path.includes('.agentistics/nay-chat')
                const encodedDir = session.project_path.replace(/\//g, '-')
                window.dispatchEvent(new CustomEvent('agentistics:open-chat', {
                  detail: isNay
                    ? { tab: 'nay', sessionId: session.session_id }
                    : { tab: 'claude', sessionId: session.session_id, project: { path: session.project_path, name: session.project_path.split('/').pop() ?? session.project_path, encodedDir } },
                }))
              }}
              title={session.project_path.includes('.agentistics/nay-chat') ? 'Open in Nay Chat' : 'Open in Claude'}
              style={{
                height: 30, padding: '0 10px',
                display: 'flex', alignItems: 'center', gap: 5,
                border: '1px solid var(--border)', borderRadius: 8,
                background: 'transparent',
                color: session.project_path.includes('.agentistics/nay-chat') ? 'var(--anthropic-orange)' : 'var(--accent-purple, #a855f7)',
                cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', fontWeight: 500,
              }}
            >
              <ExternalLink size={12} />
              {session.project_path.includes('.agentistics/nay-chat') ? 'Nay' : 'Claude'}
            </button>
            <button
              onClick={onClose}
              style={{
                width: 30, height: 30,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid var(--border)', borderRadius: 8,
                background: 'transparent', color: 'var(--text-tertiary)',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* First prompt */}
          {session.first_prompt && (
            <div style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 10,
              padding: '11px 14px',
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }}>
                {pt ? 'Prompt inicial' : 'First prompt'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, fontStyle: 'italic', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                "{session.first_prompt}"
              </div>
            </div>
          )}

          {/* KPIs */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 6 }}>
              <PrecisionToggle full={fullPrecision} accent="var(--anthropic-orange)" onToggle={() => setFullPrecision(v => !v)} lang={lang} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              <Kpi icon={<MessageSquare size={12} />} label={pt ? 'Mensagens' : 'Messages'} value={fmt(totalMessages, fullPrecision)} accent="var(--accent-blue, #3b82f6)" />
              <Kpi icon={<Zap size={12} />} label="Tokens" value={fmt(totalTokens, fullPrecision)} accent="var(--anthropic-orange)" />
              <Kpi icon={<Wrench size={12} />} label="Tool calls" value={fmt(totalTools, fullPrecision)} accent="var(--accent-green, #22c55e)" />
              <Kpi icon={<GitCommit size={12} />} label="Commits" value={String(session.git_commits ?? 0)} accent="var(--accent-purple, #a855f7)" />
              <Kpi
                icon={<span style={{ fontSize: 10, fontWeight: 800 }}>$</span>}
                label={pt ? 'Custo' : 'Cost'}
                value={fmtCost(cost, currency, brlRate)}
                accent="var(--anthropic-orange)"
              />
            </div>
          </div>

          {/* Token split */}
          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10,
            padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                {pt ? 'Divisão de tokens' : 'Token breakdown'}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                {fmt(totalTokens, fullPrecision)} total
              </span>
            </div>
            <div style={{ display: 'flex', height: 8, background: 'var(--bg-card)', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
              {totalTokens > 0 && (
                <>
                  <div style={{ width: `${(session.input_tokens ?? 0) / totalTokens * 100}%`, background: 'var(--accent-blue, #3b82f6)' }} />
                  <div style={{ width: `${(session.output_tokens ?? 0) / totalTokens * 100}%`, background: 'var(--accent-green, #22c55e)' }} />
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: 11 }}>
              <span style={{ color: 'var(--accent-blue, #3b82f6)', fontWeight: 600 }}>
                ■ Input: {fmt(session.input_tokens ?? 0, fullPrecision)}
              </span>
              <span style={{ color: 'var(--accent-green, #22c55e)', fontWeight: 600 }}>
                ■ Output: {fmt(session.output_tokens ?? 0, fullPrecision)}
              </span>
            </div>
          </div>

          {/* Tool breakdown + capabilities */}
          {toolEntries.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                {pt ? 'Uso de ferramentas' : 'Tool usage'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {toolEntries.slice(0, 12).map(([tool, count]) => {
                  const pct = count / maxToolCount
                  const tokens = session.tool_output_tokens?.[tool] ?? 0
                  return (
                    <div key={tool} style={{
                      display: 'grid',
                      gridTemplateColumns: '120px 1fr 60px 70px',
                      gap: 10,
                      alignItems: 'center',
                      fontSize: 11,
                    }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tool}
                      </span>
                      <div style={{ position: 'relative', height: 5, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0,
                          width: `${pct * 100}%`,
                          background: 'var(--accent-green, #22c55e)',
                          opacity: 0.75,
                          borderRadius: 3,
                        }} />
                      </div>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {count}×
                      </span>
                      <span style={{ color: 'var(--text-tertiary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {tokens > 0 ? `${fmt(tokens, fullPrecision)} tkn` : '—'}
                      </span>
                    </div>
                  )
                })}
                {toolEntries.length > 12 && (
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontStyle: 'italic', marginTop: 4 }}>
                    {pt ? `+${toolEntries.length - 12} outras ferramentas` : `+${toolEntries.length - 12} more tools`}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Capabilities chips */}
          {(session.uses_mcp || session.uses_web_search || session.uses_web_fetch || session.uses_task_agent) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {session.uses_task_agent && <Capability icon={<Bot size={10} />} label={pt ? 'Subagents' : 'Subagents'} color="var(--accent-purple, #a855f7)" />}
              {session.uses_mcp && <Capability icon={<Server size={10} />} label="MCP" color="var(--accent-cyan, #06b6d4)" />}
              {session.uses_web_search && <Capability icon={<Globe size={10} />} label="Web search" color="var(--accent-blue, #3b82f6)" />}
              {session.uses_web_fetch && <Capability icon={<Globe size={10} />} label="Web fetch" color="var(--accent-blue, #3b82f6)" />}
            </div>
          )}

          {/* Agent invocations */}
          {agentInvocations.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                {pt ? `Invocações de agentes (${agentInvocations.length})` : `Agent invocations (${agentInvocations.length})`}
                {session.agentMetrics && (
                  <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--text-tertiary)' }}>
                    {fmt(session.agentMetrics.totalTokens, fullPrecision)} tokens · {fmtCost(session.agentMetrics.totalCostUSD, currency, brlRate)} · {fmtAgentDuration(session.agentMetrics.totalDurationMs)}
                  </span>
                )}
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {agentInvocations.slice(0, 20).map((inv, i) => (
                  <div
                    key={inv.toolUseId || i}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '120px 1fr 55px 55px 70px',
                      gap: 10,
                      padding: '7px 12px',
                      alignItems: 'center',
                      borderBottom: i < Math.min(19, agentInvocations.length - 1) ? '1px solid var(--border-subtle)' : 'none',
                      background: i % 2 === 0 ? 'transparent' : 'var(--bg-elevated)',
                      fontSize: 11,
                    }}
                  >
                    <span style={{
                      padding: '1px 7px', borderRadius: 10,
                      background: 'rgba(148,163,184,0.15)',
                      color: 'var(--text-secondary)',
                      fontSize: 10, fontWeight: 600,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {inv.agentType}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                      {inv.status === 'failed'
                        ? <XCircle size={11} color="#ef4444" style={{ flexShrink: 0 }} />
                        : <CheckCircle size={11} color="var(--accent-green, #22c55e)" style={{ flexShrink: 0 }} />
                      }
                      <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {inv.description || <em style={{ color: 'var(--text-tertiary)' }}>—</em>}
                      </span>
                    </div>
                    <span style={{ color: 'var(--text-primary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(inv.totalTokens, fullPrecision)}</span>
                    <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>{fmtAgentDuration(inv.totalDurationMs)}</span>
                    <span style={{ color: 'var(--anthropic-orange)', textAlign: 'right' }}>{fmtCost(inv.costUSD, currency, brlRate)}</span>
                  </div>
                ))}
                {agentInvocations.length > 20 && (
                  <div style={{ padding: '7px 12px', fontSize: 10, color: 'var(--text-tertiary)', fontStyle: 'italic', background: 'var(--bg-elevated)' }}>
                    {pt ? `+${agentInvocations.length - 20} invocações omitidas` : `+${agentInvocations.length - 20} invocations hidden`}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Hour distribution + git + errors in 2 cols */}
          <div style={{ display: 'grid', gridTemplateColumns: activeHours > 0 ? '2fr 1fr' : '1fr', gap: 14, alignItems: 'start' }}>
            {activeHours > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  {pt ? 'Distribuição por hora' : 'Hour distribution'}
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40, background: 'var(--bg-elevated)', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                  {hourBuckets.map((count, h) => {
                    const pct = count / maxHour
                    return (
                      <div
                        key={h}
                        title={`${h}h: ${count} ${pt ? 'mensagens' : 'messages'}`}
                        style={{
                          flex: 1,
                          height: `${Math.max(2, pct * 100)}%`,
                          background: count > 0 ? 'var(--anthropic-orange)' : 'transparent',
                          opacity: count > 0 ? 0.4 + pct * 0.6 : 0.1,
                          borderRadius: 1,
                          minHeight: 2,
                        }}
                      />
                    )
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-tertiary)', marginTop: 3 }}>
                  <span>00h</span>
                  <span>12h</span>
                  <span>23h</span>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Git stats */}
              {(session.git_commits > 0 || session.files_modified > 0) && (
                <MiniStat
                  icon={<GitCommit size={11} />}
                  label={pt ? 'Git' : 'Git'}
                  value={
                    [
                      session.git_commits > 0 ? `${session.git_commits} commits` : null,
                      session.git_pushes > 0 ? `${session.git_pushes} pushes` : null,
                      session.files_modified > 0 ? `${session.files_modified} ${pt ? 'arquivos' : 'files'}` : null,
                      (session.lines_added > 0 || session.lines_removed > 0)
                        ? `+${fmt(session.lines_added ?? 0, fullPrecision)} / -${fmt(session.lines_removed ?? 0, fullPrecision)}`
                        : null,
                    ].filter(Boolean).join(' · ')
                  }
                  color="var(--accent-purple, #a855f7)"
                />
              )}
              {/* Response time */}
              {avgResponse !== null && (
                <MiniStat
                  icon={<Clock size={11} />}
                  label={pt ? 'Tempo de resposta' : 'Response time'}
                  value={pt
                    ? `média ${avgResponse}s · ${responseTimes.length} retornos`
                    : `avg ${avgResponse}s · ${responseTimes.length} turns`}
                  color="var(--text-tertiary)"
                />
              )}
              {/* Tool errors */}
              {session.tool_errors > 0 && (
                <MiniStat
                  icon={<AlertTriangle size={11} />}
                  label={pt ? 'Erros de ferramentas' : 'Tool errors'}
                  value={`${session.tool_errors} · ${toolErrorEntries.slice(0, 3).map(([t, c]) => `${t} (${c})`).join(', ')}`}
                  color="#ef4444"
                />
              )}
              {/* User interruptions */}
              {session.user_interruptions > 0 && (
                <MiniStat
                  icon={<MessageSquare size={11} />}
                  label={pt ? 'Interrupções' : 'Interruptions'}
                  value={String(session.user_interruptions)}
                  color="var(--text-tertiary)"
                />
              )}
              {/* Languages */}
              {(session.languages ?? []).length > 0 && (
                <MiniStat
                  icon={<FileCode size={11} />}
                  label={pt ? 'Linguagens' : 'Languages'}
                  value={session.languages.slice(0, 5).join(', ')}
                  color="var(--accent-blue, #3b82f6)"
                />
              )}
            </div>
          </div>

          {/* Agent instruction files read */}
          {Object.keys(session.agent_file_reads ?? {}).length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                {pt ? 'Arquivos de instrução lidos' : 'Instruction files read'}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(session.agent_file_reads).map(([file, count]) => (
                  <span
                    key={file}
                    style={{
                      padding: '3px 9px', borderRadius: 999,
                      background: 'var(--anthropic-orange-dim)',
                      color: 'var(--anthropic-orange)',
                      fontSize: 10, fontWeight: 600,
                      border: '1px solid var(--anthropic-orange)44',
                    }}
                  >
                    {file} · {count}×
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Kpi({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 10,
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        <span style={{ color: accent, display: 'flex' }}>{icon}</span>
        {label}
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: accent, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  )
}

function Capability({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 9px', borderRadius: 999,
      background: `${color}1e`,
      color,
      fontSize: 11, fontWeight: 600,
      border: `1px solid ${color}33`,
    }}>
      {icon}
      {label}
    </span>
  )
}

function MiniStat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      padding: '8px 10px',
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 8,
    }}>
      <span style={{ color, display: 'flex', flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 1 }}>
          {label}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-primary)', wordBreak: 'break-word', lineHeight: 1.4 }}>
          {value}
        </div>
      </div>
    </div>
  )
}
