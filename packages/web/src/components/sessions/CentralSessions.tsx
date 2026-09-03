/**
 * CentralSessions.tsx — the SESSIONS page of a central: pick a machine you can reach, and manage
 * its sessions there.
 *
 * A central hosts no sessions of its own, so this page used to say exactly that and stop. True and
 * useless: the person came to manage the sessions of the machines they have access to, and the one
 * surface that could was a drawer behind Settings → Machines — which is not where anybody looks for
 * a session.
 *
 * ONE MACHINE AT A TIME, and deliberately so. Each read makes that machine build a real fleet (a
 * tmux round trip per session), so fetching every machine on page load would tax a whole estate to
 * fill a list most of which nobody is reading. The picker is the consent for the cost.
 *
 * The list, the verbs and every refusal are `MachineFleetPanel` — the same component the drawer
 * hosts. A second implementation would be a second set of rules about what a relayed row may show
 * and which verbs it may offer.
 *
 * A machine that CANNOT be reached is named with its reason rather than left out: an empty picker
 * is one symptom with five causes, and the person looking at it is the one who needs to know which.
 */

import { useEffect, useMemo, useState } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import type { Filters } from '@agentistics/core'
import { MachineFleetPanel } from '../../pages/settings/MachineFleetPanel'
import { SessionsAside } from '../nav/SessionsAside'
import { centralMachineList, pickCentralMachine, type CentralMachine } from '../../lib/centralMachines'
import { relayedToSessions, type RelayedRow } from '../../lib/relayedSessions'

/** Remembers the machine you were last looking at, per browser. */
const PICK_KEY = 'agentistics-central-machine'

export function CentralSessions({ lang, filters, activeOnly }: {
  lang: 'pt' | 'en'
  /** The SAME filters the header edits — the list narrows exactly as it does on a machine. */
  filters: Filters
  activeOnly: boolean
}) {
  const pt = lang === 'pt'
  const [machines, setMachines] = useState<CentralMachine[] | null>(null)
  const [me, setMe] = useState<string>('')
  const [failed, setFailed] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  /** The chosen machine's relayed rows, for the list. `null` = not read yet. */
  const [rows, setRows] = useState<RelayedRow[] | null>(null)
  const [rowsFor, setRowsFor] = useState<string | null>(null)
  /** The row whose verbs are open. One at a time — this is the list, not a control panel. */
  const [openRow, setOpenRow] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [mRes, aRes] = await Promise.all([
          fetch('/api/iam/me'),
          fetch('/api/iam/machines'),
        ])
        const meBody = mRes.ok ? await mRes.json() as { account?: { id?: string } } : null
        const list = aRes.ok ? await aRes.json() as CentralMachine[] | { machines?: CentralMachine[] } : null
        if (!live) return
        setMe(meBody?.account?.id ?? '')
        setMachines(Array.isArray(list) ? list : (list?.machines ?? []))
      } catch {
        // A failed read is NOT an empty estate — the difference is the whole point of the sentence
        // this page draws below.
        if (live) setFailed(true)
      }
    })()
    return () => { live = false }
  }, [])

  const list = useMemo(
    () => centralMachineList(machines ?? [], me, pt ? 'pt' : 'en'),
    [machines, me, pt],
  )

  // Settled once, when the list first arrives, and then owned by the picker.
  useEffect(() => {
    if (machines === null) return
    setPicked(prev => prev ?? pickCentralMachine(list, localStorage.getItem(PICK_KEY)))
  }, [machines, list])

  // The rows the LIST draws. The panel below reads the same route for the verbs — one extra call
  // per machine change, and the alternative was threading the answer out of the panel, which would
  // make the panel's own hosts depend on a caller that does not exist for them.
  useEffect(() => {
    setOpenRow(null)
    if (!picked) { setRows(null); return }
    let live = true
    setRows(null); setRowsFor(picked)
    void (async () => {
      try {
        const res = await fetch(`/api/team/machine-fleet?machineId=${encodeURIComponent(picked)}`)
        const body = res.ok ? await res.json() as { reply?: { rows?: RelayedRow[] } } : null
        if (live) setRows(body?.reply?.rows ?? [])
      } catch {
        if (live) setRows([])
      }
    })()
    return () => { live = false }
  }, [picked])

  const sessions = useMemo(() => relayedToSessions(rows ?? []), [rows])

  const choose = (id: string) => {
    setPicked(id)
    try { localStorage.setItem(PICK_KEY, id) } catch { /* private mode — the choice is a convenience */ }
  }

  if (failed) {
    return (
      <Note text={pt
        ? 'Não deu para ler a lista de máquinas desta central. Isso não quer dizer que não há nenhuma — recarregue a página.'
        : 'This central’s machine list could not be read. That is not the same as there being none — reload the page.'} />
    )
  }
  if (machines === null) {
    return <Note text={pt ? 'Lendo as máquinas desta central…' : 'Reading this central’s machines…'} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {list.reachable.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {list.reachable.map(m => {
            const on = m.id === picked
            return (
              <button
                key={m.id}
                onClick={() => choose(m.id)}
                aria-pressed={on}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, minHeight: 40,
                  padding: '7px 12px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit',
                  fontSize: 12.5, fontWeight: on ? 700 : 600,
                  border: `1px solid ${on ? 'var(--anthropic-orange)' : 'var(--border)'}`,
                  background: on ? 'color-mix(in srgb, var(--anthropic-orange) 12%, transparent)' : 'transparent',
                  color: on ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
                }}
              >
                <MonitorSmartphone size={13} style={{ flexShrink: 0 }} />
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</span>
                {/* Online is a fact about whether it can answer NOW, so it is on the chip rather
                    than discovered by pressing it and waiting. */}
                <span
                  aria-hidden
                  style={{
                    width: 6, height: 6, borderRadius: 3, flexShrink: 0,
                    background: m.online ? 'var(--accent-green)' : 'var(--text-tertiary)',
                    opacity: m.online ? 1 : 0.55,
                  }}
                />
              </button>
            )
          })}
        </div>
      )}

      {picked
        ? (
          <>
            {/* THE SAME LIST a machine draws — grouping, ordering, search, the state words and the
                row's own shape are decided in one place for both. Its "new session" is withheld:
                starting one spawns a process on the HOST, which a central cannot do for someone
                else's machine. */}
            <SessionsAside
              lang={lang}
              rows={sessions}
              finishedTasks={[]}
              loading={rows === null || rowsFor !== picked}
              unsupported={false}
              filters={filters}
              activeOnly={activeOnly}
              hideNew
              onOpenRow={r => setOpenRow(prev => (prev === r.id ? null : r.id))}
            />

            {/* Tapping a row opens ITS verbs, and nothing else. The panel used to draw the whole
                fleet again underneath the list — the same sessions in a second shape, which is
                what made the page read as two different listings. */}
            {openRow && (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 8,
                padding: '10px 12px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--bg-elevated)',
              }}>
                <button
                  onClick={() => setOpenRow(null)}
                  style={{
                    alignSelf: 'flex-start', minHeight: 32, padding: '4px 10px', borderRadius: 7,
                    border: '1px solid var(--border-subtle)', background: 'transparent',
                    color: 'var(--text-tertiary)', fontFamily: 'inherit', fontSize: 11.5,
                    cursor: 'pointer',
                  }}
                >
                  {pt ? 'Fechar' : 'Close'}
                </button>
                <MachineFleetPanel open machineId={picked} lang={pt ? 'pt' : 'en'} onlyRow={openRow} hideHeader />
              </div>
            )}
          </>
        )
        : (
          <Note text={list.blocked.length > 0
            ? (pt
              ? 'Nenhuma máquina desta central está permitindo gerenciar sessões daqui agora.'
              : 'No machine on this central is currently allowing session management from here.')
            : (pt
              ? 'Nenhuma máquina para gerenciar ainda.'
              : 'No machines to manage yet.')} />
        )}

      {/* The ones that cannot be reached, each with the reason — never silently absent. */}
      {list.blocked.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{
            margin: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.06em', color: 'var(--text-tertiary)',
          }}>
            {pt ? 'Fora de alcance' : 'Out of reach'}
          </p>
          {list.blocked.map(m => (
            <div key={m.id} style={{
              display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8,
              padding: '8px 10px', borderRadius: 9,
              border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
            }}>
              <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--text-secondary)' }}>{m.name}</span>
              <span style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-tertiary)', minWidth: 0 }}>
                {m.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Note({ text }: { text: string }) {
  return (
    <p role="status" style={{
      margin: 0, padding: '14px 4px', fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-tertiary)',
    }}>
      {text}
    </p>
  )
}
