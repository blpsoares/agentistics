import { MessageSquare, Clock, Minimize2, Sparkles, Plug, Bot, Hash, AlertTriangle } from 'lucide-react'
import type { Baseline, ProfileMetric } from '@agentistics/core'
import { SHOWN, roundProfile } from '@agentistics/tui/control/profile-lines'

/**
 * The labels are `Record<ProfileMetric, string>` with NO `?? key` fallback: a seventh metric added
 * to `SHOWN` must fail the build here rather than printing `activeMinutes` at a reader. `SHOWN` and
 * `roundProfile` themselves come from the cockpit's own pure module — this panel used to re-declare
 * both, so a metric added there reached the terminal and silently not the dashboard.
 *
 * The LABELS still are not shared, though — this file keeps its own EN/PT copy of the cockpit's
 * `PROFILE_METRIC_EN`/`PROFILE_METRIC_PT` (`packages/tui/src/control/i18n.ts`) rather than importing
 * them, because this panel's copy is the DASHBOARD's own wording and the two are allowed to read
 * differently. What must not drift is which KEYS each one covers — `ProfilePanel.test.ts` cross-
 * checks that.
 */
export const LABEL_EN: Record<ProfileMetric, string> = {
  messages: 'messages', activeMinutes: 'active minutes', compacts: 'compacts',
  skills: 'skills', mcpServers: 'MCP servers', subagents: 'subagents',
  tokens: 'tokens', toolErrors: 'tool errors',
}
export const LABEL_PT: Record<ProfileMetric, string> = {
  messages: 'mensagens', activeMinutes: 'minutos ativos', compacts: 'compacts',
  skills: 'skills', mcpServers: 'servidores MCP', subagents: 'subagentes',
  tokens: 'tokens', toolErrors: 'erros de ferramenta',
}

/**
 * One icon and one tone per metric — the same visual language `FleetOverview`'s own stat cards use
 * (an icon in a tone colour, over a big number). The panel used to be plain numbered boxes with no
 * colour and no icon, sitting directly under those cards and reading like a different, cheaper
 * product bolted onto the bottom of a polished one — reported as "essas métricas feias". A metric
 * this table has no entry for is a build error, the same guarantee `LABEL_EN`/`LABEL_PT` give.
 */
const ICON: Record<ProfileMetric, React.ComponentType<{ size?: number }>> = {
  messages: MessageSquare, activeMinutes: Clock, compacts: Minimize2,
  skills: Sparkles, mcpServers: Plug, subagents: Bot,
  tokens: Hash, toolErrors: AlertTriangle,
}
const TONE: Record<ProfileMetric, string> = {
  messages: 'var(--accent-blue)', activeMinutes: 'var(--text-tertiary)', compacts: 'var(--accent-cyan)',
  skills: 'var(--anthropic-orange)', mcpServers: 'var(--accent-purple)', subagents: 'var(--accent-green)',
  tokens: 'var(--accent-blue)', toolErrors: 'var(--accent-red)',
}

/**
 * The behaviour profile, shown where the sessions list is empty.
 *
 * A metric with `n === 0` is DROPPED, never rendered as a zero — the same N/A-versus-a-confident-0
 * rule `HARNESS_CAPABILITIES` applies to harness metrics. This is the REAL complement to the empty
 * state's sentence above it, not a placeholder: every figure is a measurement off this machine's own
 * last `windowDays`, with its own sample size printed beside it rather than implied.
 */
export function ProfilePanel({ baseline, pt }: { baseline?: Baseline; pt: boolean }) {
  if (!baseline) return null
  const label = pt ? LABEL_PT : LABEL_EN
  const rows = SHOWN
    .map(k => ({ k, m: baseline.metrics[k] }))
    .filter(r => r.m && r.m.n > 0)
  if (rows.length === 0) return null

  return (
    <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {pt
          ? `Seus últimos ${baseline.windowDays} dias · ${baseline.sessions} sessões`
          : `Your last ${baseline.windowDays} days · ${baseline.sessions} sessions`}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
        {rows.map(({ k, m }) => {
          const Icon = ICON[k]
          const tone = TONE[k]
          return (
            <div key={k} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12,
              padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0,
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: tone }}>
                <Icon size={14} />
                <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>
                  {label[k]}
                </span>
              </span>
              <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
                {roundProfile(m!.median)}
              </span>
              <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>
                {pt ? `mediana · n=${m!.n}` : `median · n=${m!.n}`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
