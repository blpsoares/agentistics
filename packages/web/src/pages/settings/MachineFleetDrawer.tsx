/**
 * MachineFleetDrawer.tsx — one machine's session fleet, relayed to its owning account.
 *
 * A READ. There are no verbs here: acting on another machine's sessions is the next phase, and
 * shipping a button before the thing behind it exists is how a control ends up silently inert.
 *
 * Every sentence comes from the pure `machineFleetPanelView`, which keeps the four refusals and the
 * one real "no sessions" apart. Nothing here may render an empty list for a fleet nobody managed to
 * read — the same N/A-versus-a-confident-0 rule the dashboard applies to harness capabilities.
 *
 * The screen and the conversation are ABSENT by construction, not hidden: the row that crosses the
 * wire is built by an allowlist (`reduceMachineFleetRow`), so there is nothing to leave out here.
 */

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import type { MachineFleetAnswer } from '@agentistics/core'
import { Drawer } from './Drawer'
import { useIsMobile } from '../../hooks/useIsMobile'
import { machineFleetPanelView } from './machineFleetView'

export function MachineFleetDrawer({ open, machineId, machineName, lang, onClose }: {
  open: boolean
  machineId: string
  machineName: string
  lang: 'en' | 'pt'
  onClose: () => void
}) {
  const pt = lang === 'pt'
  const isMobile = useIsMobile()
  const [answer, setAnswer] = useState<MachineFleetAnswer | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/team/machine-fleet?machineId=${encodeURIComponent(machineId)}`)
      setAnswer(res.ok ? ((await res.json()) as MachineFleetAnswer) : null)
    } catch {
      // `null` is its own sentence in machineFleetPanelView — never an empty list.
      setAnswer(null)
    } finally {
      setLoading(false)
    }
  }

  // Asked ONLY while the drawer is open. The request travels to another machine and makes it build
  // a real fleet (a tmux round trip per session), so it is a deliberate act, never a poll running
  // behind a closed panel.
  useEffect(() => {
    if (!open || !machineId) return
    setAnswer(null)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, machineId])

  const view = machineFleetPanelView(answer, lang)
  const rows = answer?.reply?.rows ?? []

  return (
    <Drawer open={open} title={machineName} onClose={onClose} lang={lang}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13 }}>
            {loading ? (pt ? 'Perguntando à máquina…' : 'Asking the machine…') : view.text}
          </strong>
          <button
            type="button"
            onClick={() => { void load() }}
            disabled={loading}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              minHeight: isMobile ? 44 : 28, padding: isMobile ? '0 14px' : '0 10px',
              borderRadius: 7, border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-secondary)', fontFamily: 'inherit', fontSize: 11.5,
              cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
            }}
          >
            {loading
              ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              : <RefreshCw size={12} />}
            {pt ? 'Atualizar' : 'Refresh'}
          </button>
        </div>

        {/* The machine's own caveat, and what its sharing rules withheld. Two different facts, and
            neither is a fault — one is a limit the machine reported, the other is the user's own
            rule. Neither wears an alarm colour. */}
        {view.notes.map(note => (
          <p key={note} style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
            {note}
          </p>
        ))}

        {rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map(r => (
              <div
                key={r.id}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 4,
                  padding: '10px 12px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  {/* `overflowWrap`, not nowrap: a session title plus a state word overflows a
                      390px drawer, and the page body must never scroll horizontally. */}
                  <strong style={{ fontSize: 12.5, overflowWrap: 'anywhere', minWidth: 0 }}>{r.title}</strong>
                  <span style={{
                    flexShrink: 0, padding: '1px 7px', borderRadius: 999,
                    fontSize: 10, fontWeight: 700,
                    border: `1px solid ${r.state === 'waiting-approval' || r.state === 'waiting' ? 'var(--anthropic-orange)' : 'var(--border)'}`,
                    color: r.state === 'waiting-approval' || r.state === 'waiting' ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
                  }}>
                    {/* The word the MACHINE resolved, in its own language — never re-derived here. */}
                    {r.stateLabel}
                  </span>
                </div>
                {/* Built from the parts that ACTUALLY have a value. A row can legitimately arrive
                    thin — the machine's first fleet build of a cold process has not resolved its
                    harness or repo facts yet, and it fills in on the next ask — and joining fixed
                    parts printed a bare " · " that reads as a broken cell rather than as a fact
                    nobody has yet. */}
                {[r.harness, r.model, r.cwd].filter(Boolean).length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                    {[r.harness, r.model, r.cwd].filter(Boolean).join(' · ')}
                  </div>
                )}
                {(r.task || r.note) && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>
                    {r.task ? `${pt ? 'Tarefa' : 'Task'}: ${r.task}` : ''}
                    {r.task && r.note ? ' · ' : ''}
                    {r.note ? `${pt ? 'Nota' : 'Note'}: ${r.note}` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Said once, at the bottom, rather than as a disabled button per row: there is nothing to
            press yet, and a greyed-out verb implies one is coming back. */}
        <p style={{ margin: 0, fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-tertiary)' }}>
          {pt
            ? 'Somente leitura. A tela e a conversa das sessões não saem da máquina.'
            : 'Read-only. A session’s screen and conversation never leave the machine.'}
        </p>
      </div>
    </Drawer>
  )
}
