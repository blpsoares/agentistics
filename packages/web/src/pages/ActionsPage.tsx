import React, { useMemo } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import { Zap, ArrowLeft, GitCommit, ExternalLink } from 'lucide-react'
import type { AppContext } from '../lib/app-context'
import { repoShortName, fmt, fmtCost, calcCost, type SessionMeta } from '@agentistics/core'
import { Section } from '../components/Section'

/** Global GitHub Actions view: every CI runner session (SessionMeta.ci) grouped by repo. */
export default function ActionsPage() {
  const ctx = useOutletContext<AppContext>()
  const { derived, currency, brlRate, lang } = ctx
  const navigate = useNavigate()
  const pt = lang === 'pt'

  const groups = useMemo(() => {
    const byRepo: Record<string, { remote: string; runs: number; tokensIn: number; tokensOut: number; commits: number; costUSD: number; users: Set<string> }> = {}
    for (const s of derived.filteredSessions) {
      if (!s.ci) continue
      const key = s.git_remote || ''
      let g = byRepo[key]
      if (!g) g = byRepo[key] = { remote: key, runs: 0, tokensIn: 0, tokensOut: 0, commits: 0, costUSD: 0, users: new Set() }
      g.runs++
      g.tokensIn += s.input_tokens ?? 0
      g.tokensOut += s.output_tokens ?? 0
      g.commits += s.git_commits ?? 0
      g.costUSD += sessionCost(s)
      if (s.user) g.users.add(s.user)
    }
    return Object.values(byRepo).sort((a, b) => b.costUSD - a.costUSD || b.runs - a.runs)
  }, [derived.filteredSessions])

  const totalRuns = groups.reduce((a, g) => a + g.runs, 0)
  const totalCost = groups.reduce((a, g) => a + g.costUSD, 0)

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={() => navigate('/repositories')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, alignSelf: 'flex-start', fontSize: 12, color: 'var(--text-tertiary)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
        >
          <ArrowLeft size={13} /> {pt ? 'Repositórios' : 'Repositories'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          <span style={{ color: 'var(--accent-blue)' }}><Zap size={16} /></span>
          {pt ? 'GitHub Actions' : 'GitHub Actions'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          {pt
            ? 'Tokens e custos gastos por agentes rodando em GitHub Actions (Claude Code Actions), agrupados por repositório — respeita os filtros ativos.'
            : 'Tokens and cost spent by agents running in GitHub Actions (Claude Code Actions), grouped by repository — respects active filters.'}
        </div>
      </div>

      <Section title={<><Zap size={14} /> {pt ? `${groups.length} repositório${groups.length === 1 ? '' : 's'} · ${totalRuns} runs` : `${groups.length} repositor${groups.length === 1 ? 'y' : 'ies'} · ${totalRuns} runs`}</>}
        action={<span style={{ fontSize: 12, fontWeight: 700, color: 'var(--anthropic-orange)' }}>{fmtCost(totalCost, currency, brlRate)}</span>}
      >
        {groups.length === 0 ? (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: 24, textAlign: 'center', lineHeight: 1.6 }}>
            {pt
              ? 'Nenhum run de GitHub Actions registrado ainda. Registre um repositório na central (agentop repo register) e adicione o workflow do agentistics para enviar métricas do Claude Code Actions.'
              : 'No GitHub Actions runs recorded yet. Register a repository on the central (agentop repo register) and add the agentistics workflow to push Claude Code Actions metrics.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {groups.map(g => {
              const linked = g.remote !== ''
              return (
                <div
                  key={g.remote || '__none__'}
                  onClick={() => navigate(linked ? `/repo/${encodeURIComponent(g.remote)}` : '/repo/__none__')}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', background: 'var(--bg-elevated)', borderRadius: 9, border: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                >
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {linked ? repoShortName(g.remote) : (pt ? 'Sem repositório' : 'No repository')}
                    {linked && <ExternalLink size={11} color="var(--text-tertiary)" />}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{g.runs} runs</span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{fmt(g.tokensIn + g.tokensOut)} tok</span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><GitCommit size={11} />{g.commits}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--anthropic-orange)', width: 90, textAlign: 'right' }}>{fmtCost(g.costUSD, currency, brlRate)}</span>
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </>
  )
}

function sessionCost(s: SessionMeta): number {
  if (!s.model) {
    // No model → best-effort: treat all tokens as sonnet-blend via calcCost fallback (getModelPrice).
    return calcCost({
      inputTokens: s.input_tokens ?? 0, outputTokens: s.output_tokens ?? 0,
      cacheReadInputTokens: s.cache_read_input_tokens ?? 0, cacheCreationInputTokens: s.cache_creation_input_tokens ?? 0,
      webSearchRequests: 0, costUSD: 0,
    }, '')
  }
  return calcCost({
    inputTokens: s.input_tokens ?? 0, outputTokens: s.output_tokens ?? 0,
    cacheReadInputTokens: s.cache_read_input_tokens ?? 0, cacheCreationInputTokens: s.cache_creation_input_tokens ?? 0,
    webSearchRequests: 0, costUSD: 0,
  }, s.model)
}
