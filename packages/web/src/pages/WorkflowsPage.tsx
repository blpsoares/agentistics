import React, { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Workflow as WorkflowIcon, ChevronDown, ChevronRight } from 'lucide-react'
import type { WorkflowRun } from '@agentistics/core'
import { getModelPrice, fmtCost } from '@agentistics/core'
import type { AppContext } from '../lib/app-context'
import { Section } from '../components/Section'

/** Average of input/output USD-per-1M-token rates. */
function perMillionUSD(model: string) {
  const p = getModelPrice(model)
  return (p.input + p.output) / 2
}

export default function WorkflowsPage() {
  const ctx = useOutletContext<AppContext>()
  const { data, lang, brlRate, currency } = ctx
  const pt = lang === 'pt'
  const runs = data.workflows ?? []

  return (
    <>
      <PageHeader
        icon={<WorkflowIcon size={16} />}
        title="Workflows"
        subtitle={pt
          ? 'Execuções de workflow: fases, agentes, modelo, tokens e custo.'
          : 'Workflow runs: phases, agents, model, tokens and cost.'}
      />

      {runs.length === 0
        ? (
          <Section flashId="wf-empty" title={pt ? 'Nenhum workflow' : 'No workflows'}>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '8px 2px' }}>
              {pt ? 'Nenhuma execução de workflow encontrada.' : 'No workflow runs found.'}
            </div>
          </Section>
        )
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {runs.map(run => <RunBlock key={run.runId} run={run} pt={pt} rate={brlRate} currency={currency} />)}
          </div>
        )}
    </>
  )
}

function PageHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
        <span style={{ color: 'var(--anthropic-orange)' }}>{icon}</span>
        {title}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{subtitle}</div>
    </div>
  )
}

function RunBlock({ run, pt, rate, currency }: { run: WorkflowRun; pt: boolean; rate: number; currency: 'USD' | 'BRL' }) {
  const [open, setOpen] = useState(true)
  const statusColor = run.status === 'completed' ? '#22c55e' : run.status === 'partial' ? '#eab308' : '#ef4444'
  return (
    <Section
      flashId={`wf-${run.runId}`}
      title={
        <span onClick={() => setOpen(o => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
          {run.name}
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 400 }}>
            · {run.totals.agentCount} {pt ? 'agentes' : 'agents'} · {(run.totals.tokensIn + run.totals.tokensOut).toLocaleString()} tkn · {fmtCost(run.totals.costUSD, currency, rate)}
          </span>
        </span>
      }
    >
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {run.phases.map(ph => (
            <div key={ph.title}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                {ph.title} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>({ph.agentCount})</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: 'var(--text-tertiary)', textAlign: 'left' }}>
                      <th style={cell}>{pt ? 'Agente' : 'Agent'}</th>
                      <th style={cell}>{pt ? 'Modelo' : 'Model'}</th>
                      <th style={cellR}>In</th>
                      <th style={cellR}>Out</th>
                      <th style={cellR}>{pt ? 'Custo' : 'Cost'}</th>
                      <th style={cellR}>{pt ? 'Custo/M' : 'Cost/M'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.agents.filter(a => a.phase === ph.title).map((a, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={cell}>{a.label}</td>
                        <td style={cell}>{a.model || '—'}</td>
                        <td style={cellR}>{a.tokensIn.toLocaleString()}</td>
                        <td style={cellR}>{a.tokensOut.toLocaleString()}</td>
                        <td style={cellR}>{fmtCost(a.costUSD, currency, rate)}</td>
                        <td style={cellR}>{a.model ? fmtCost(perMillionUSD(a.model), currency, rate) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {run.agents.some(a => !a.phase) && (
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {pt ? 'Alguns agentes sem fase identificada.' : 'Some agents without an identified phase.'}
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

const cell: React.CSSProperties = { padding: '6px 8px' }
const cellR: React.CSSProperties = { padding: '6px 8px', textAlign: 'right' }
