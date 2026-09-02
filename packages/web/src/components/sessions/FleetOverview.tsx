/**
 * FleetOverview — the sessions workspace with nothing selected.
 *
 * A landing screen, not filler: what the fleet is doing right now, so the workspace answers a
 * question before you have picked anything.
 *
 * Every figure comes from the pure `summarizeFleet`, and the one figure that can be absent — how
 * long the running sessions have been up — is rendered as a SENTENCE when it is, never as a zero.
 * Same for the whole screen: a central hosts no sessions, an exposed profile refuses the route, and
 * a failed poll is not an empty fleet. Those are four different facts and this file keeps them four
 * different sentences.
 */

import { useMemo } from 'react'
import { Activity, Bell, FolderGit2, Power } from 'lucide-react'
import type { ControlSession } from '@agentistics/tui/control/session-fleet'
import { HARNESS_COLORS, HARNESS_LABELS } from '../../lib/harness'
import { formatUptime, summarizeFleet } from '../../lib/fleetSummary'

export interface FleetOverviewProps {
  lang: 'pt' | 'en'
  rows: readonly ControlSession[]
  loading: boolean
  unsupported: boolean
  unavailable?: string
}

export function FleetOverview({ lang, rows, loading, unsupported, unavailable }: FleetOverviewProps) {
  const pt = lang === 'pt'
  const s = useMemo(() => summarizeFleet(rows, Date.now()), [rows])

  if (loading || unsupported || unavailable || rows.length === 0) {
    return (
      <Notice text={loading
        ? (pt ? 'Lendo as sessões desta máquina…' : 'Reading this machine’s sessions…')
        : unsupported
          ? (pt
              ? 'Esta instalação não pode ler sessões. Um central agrega várias máquinas e não hospeda as sessões de nenhuma delas, e um perfil de exposição sem poder sobre o host também recusa essa leitura — então não há frota para resumir aqui, o que é diferente de uma frota vazia.'
              : 'This install cannot read sessions. A central aggregates many machines and hosts none of their sessions, and an exposure profile with no host power refuses the read too — so there is no fleet to summarize here, which is not the same as an empty one.')
          : unavailable
            ? unavailable
            : (pt
                ? 'Nenhuma sessão nesta máquina ainda. Inicie uma pelo agentop e ela aparece aqui.'
                : 'No sessions on this machine yet. Start one with agentop and it shows up here.')}
      />
    )
  }

  return (
    <div style={{ padding: '28px 24px', maxWidth: 980, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
        {pt ? 'Suas sessões' : 'Your sessions'}
      </h1>
      <p style={{ margin: '0 0 22px', fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.55 }}>
        {pt
          ? 'O que está rodando nesta máquina agora. Escolha uma sessão na lateral para abri-la.'
          : 'What is running on this machine right now. Pick a session on the left to open it.'}
      </p>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 22,
      }}>
        <Stat
          icon={<Activity size={15} />} tone="#22c55e"
          label={pt ? 'Rodando' : 'Running'} value={String(s.running)}
          note={pt ? `de ${s.total} no total` : `of ${s.total} total`}
        />
        <Stat
          icon={<Bell size={15} />} tone="var(--anthropic-orange)"
          label={pt ? 'Precisam de você' : 'Need you'} value={String(s.waiting)}
          note={s.waiting > 0
            ? (pt ? 'aguardando resposta' : 'waiting on an answer')
            : (pt ? 'nada bloqueado' : 'nothing blocked')}
        />
        <Stat
          icon={<Power size={15} />} tone="var(--text-tertiary)"
          label={pt ? 'Tempo ativo' : 'Active time'}
          // The one figure that can be missing. A dash and a sentence, never a zero — "nothing has
          // been up for any time" and "nothing records when they started" are different claims.
          value={s.activeMs === undefined ? '—' : formatUptime(s.activeMs)}
          note={s.activeMs === undefined
            ? (pt ? 'nenhuma sessão registra quando começou' : 'no session records when it started')
            : s.activeUnknown > 0
              ? (pt ? `${s.activeUnknown} sem hora de início` : `${s.activeUnknown} with no start time`)
              : (pt ? 'somado nas sessões vivas' : 'summed across live sessions')}
        />
        <Stat
          icon={<FolderGit2 size={15} />} tone="#a855f7"
          label={pt ? 'Projetos' : 'Projects'} value={String(s.projects)}
          note={pt ? 'com sessão registrada' : 'with a session on record'}
        />
      </div>

      <section>
        <h2 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
          {pt ? 'Por assistente' : 'By assistant'}
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {s.harnesses.map(h => {
            const color = (HARNESS_COLORS as Record<string, string>)[h.harness] ?? 'var(--text-tertiary)'
            const label = (HARNESS_LABELS as Record<string, string>)[h.harness] ?? h.harness
            const pct = s.total === 0 ? 0 : Math.round((h.count / s.total) * 100)
            return (
              <div key={h.harness} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 110, fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', flexShrink: 0 }}>
                  {label}
                </span>
                {/* The bar is a proportion of the fleet; the numbers beside it are the fact. A bar
                    alone would be a share nobody can read off the screen. */}
                <span style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-elevated)', overflow: 'hidden', minWidth: 60 }}>
                  <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: color, borderRadius: 4 }} />
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', width: 112, textAlign: 'right', flexShrink: 0 }}>
                  {h.running > 0
                    ? (pt ? `${h.count} · ${h.running} viva${h.running > 1 ? 's' : ''}` : `${h.count} · ${h.running} live`)
                    : (pt ? `${h.count} · nenhuma viva` : `${h.count} · none live`)}
                </span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Stat({ icon, tone, label, value, note }: {
  icon: React.ReactNode; tone: string; label: string; value: string; note: string
}) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12,
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0,
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: tone }}>
        {icon}
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>
          {label}
        </span>
      </span>
      <span style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>{note}</span>
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', minHeight: 320, padding: 32,
    }}>
      <p style={{
        margin: 0, maxWidth: 460, textAlign: 'center',
        fontSize: 13, lineHeight: 1.6, color: 'var(--text-tertiary)',
      }}>
        {text}
      </p>
    </div>
  )
}
