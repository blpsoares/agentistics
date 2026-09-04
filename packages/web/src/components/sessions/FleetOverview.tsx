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
import { ActivityHeatmap } from '../ActivityHeatmap'

export interface HeatmapDay { date: string; value: number; sessions: number; tools: number }

/**
 * The container geometry the sessions workspace shares with the header's filter row.
 *
 * BOTH numbers, because matching only one is what produced the second version of this bug: with
 * equal padding but no shared max width, the two lined up at 1440px and drifted 53px apart at
 * 1773px — the header's row lives in a centred 1400px box, so its left edge MOVES with the window
 * and a left-aligned body cannot follow it.
 *
 * Named once and used by both, because the alignment IS the requirement: whatever these become,
 * the row above and the body below have to move together.
 */
export const PAGE_INSET = 32
export const PAGE_MAX_WIDTH = 1400

export interface FleetOverviewProps {
  lang: 'pt' | 'en'
  rows: readonly ControlSession[]
  loading: boolean
  unsupported: boolean
  unavailable?: string
  /**
   * The combined activity calendar, already narrowed by every active filter — `derived.heatmapData`
   * from `useDerivedStats`, never a second aggregation. `stats-cache.json` stays Claude-only here as
   * everywhere: this is per-session sums, the same source the dashboard's own heatmap reads.
   */
  heatmap?: readonly HeatmapDay[]
}

export function FleetOverview({ lang, rows, loading, unsupported, unavailable, heatmap }: FleetOverviewProps) {
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

  // ALIGNED WITH THE HEADER'S FILTER BAR — the thing directly above it, and the only edge a
  // reader can compare it against.
  //
  // It took two wrong attempts to get here, and both are worth stating. It began centred in a
  // 980px box while the header was centred in a 1400px one, so at 1262px the body sat 200px to the
  // right of the filters. Left-aligning it fixed that width and broke every wider one: the header
  // is CENTRED, so its left edge moves, and a left-aligned body only agrees with it by accident.
  // Matching the geometry — same max width, same inset, same centring — is the only thing that
  // holds at every size.
  return (
    <div style={{
      padding: `28px ${PAGE_INSET}px`,
      maxWidth: PAGE_MAX_WIDTH,
      margin: '0 auto',
      width: '100%',
      boxSizing: 'border-box',
    }}>
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
          icon={<Activity size={15} />} tone="var(--accent-green)"
          label={pt ? 'Rodando' : 'Running'} value={String(s.running)}
          // Names the UNIVERSE: "of 23 total" sat a few centimetres from a header reading "961
          // sessions" and invited the reader to compare two counts of different things. This one
          // is the fleet on this machine; that one is the whole metrics history.
          // "on this machine" was a claim this number cannot make: the list holds the live fleet
          // plus a BOUNDED window of recent conversations (`DEFAULT_CLOSED_LIMIT`), not the
          // machine's whole history — a machine with a thousand stored conversations reads 306
          // here. It names the LIST, which is what it actually counts.
          note={pt ? `de ${s.total} nesta lista` : `of ${s.total} in this list`}
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
          icon={<FolderGit2 size={15} />} tone="var(--accent-purple)"
          label={pt ? 'Projetos' : 'Projects'} value={String(s.projects)}
          note={pt ? 'com sessão registrada' : 'with a session on record'}
        />
      </div>

      {/* ONE calendar for every harness in view, not one strip each — the per-harness split lives
          in the day tooltip, which is where a comparison is actually made.

          It reads `derived.heatmapData`, which `useDerivedStats` has ALREADY narrowed by every
          active filter. That is the requirement, not a convenience: a heatmap beside filtered
          stats that is itself unfiltered puts two numbers on one screen under two different
          rules, which is the same defect as a cache-backed total beside a session-summed one. */}
      {heatmap && heatmap.length > 0 && (
        <section style={{ marginBottom: 22 }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
            {pt ? 'Atividade' : 'Activity'}
          </h2>
          <ActivityHeatmap data={[...heatmap]} weeks={26} />
        </section>
      )}
      {heatmap && heatmap.length === 0 && (
        // Never an all-zero grid: an empty measurement and "nothing in this window" are different
        // facts, and a grid of empty cells reads as the first while meaning the second.
        <p style={{ margin: '0 0 22px', fontSize: 12, color: 'var(--text-tertiary)' }}>
          {pt
            ? 'Nenhuma atividade no período e nos filtros escolhidos.'
            : 'No activity in the chosen window and filters.'}
        </p>
      )}

      <section>
        <h2 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
          {pt ? 'Por assistente' : 'By assistant'}
        </h2>
        {/* Said once, under the heading, because a list with a single row invites the question
            "where are my other assistants". They are not missing: this section counts the fleet on
            this machine, and an assistant with nothing running and nothing recorded here has no
            row — which is a real zero, not an unmeasured one. Their history is on the dashboard. */}
        {s.harnesses.length === 1 && (
          <p style={{ margin: '0 0 10px', fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-tertiary)' }}>
            {pt
              ? 'Só assistentes presentes nesta lista aparecem aqui — ela cobre o que está rodando mais as conversas recentes, não todo o histórico. O total de cada assistente está no painel e na comparação.'
              : 'Only assistants present in this list appear here — it covers what is running plus recent conversations, not the whole history. Each assistant’s total is on the dashboard and on Compare.'}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {s.harnesses.map(h => {
            const color = (HARNESS_COLORS as Record<string, string>)[h.harness] ?? 'var(--text-tertiary)'
            // A session whose harness could not be NAMED still exists and is still counted — an
            // assistant found running that no adapter recognises reports an empty harness. It used
            // to render as a bar with a BLANK label beside it, which reads as a fault in the panel
            // rather than a fact about the fleet. The row says what it is instead; dropping it
            // would make the percentages beside it stop adding up.
            const label = (HARNESS_LABELS as Record<string, string>)[h.harness]
              ?? (h.harness.trim() === ''
                ? (pt ? 'assistente não identificado' : 'unidentified assistant')
                : h.harness)
            const pct = s.total === 0 ? 0 : Math.round((h.count / s.total) * 100)
            return (
              <div key={h.harness} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 110, fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', flexShrink: 0 }}>
                  {label}
                </span>
                {/* The bar is a share of the fleet, 0–100, and the SHARE IS SAID IN A NUMBER
                    beside it. A full bar with no figure is unreadable in the ordinary case where
                    one assistant holds everything: it looks like a progress bar that finished
                    rather than "this is all of them", which is what a reader asked about it. */}
                <span
                  role="img"
                  aria-label={`${pct}%`}
                  style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-elevated)', overflow: 'hidden', minWidth: 60 }}
                >
                  <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: color, borderRadius: 4 }} />
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 44, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {pct}%
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)', width: 120, textAlign: 'right', flexShrink: 0 }}>
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
