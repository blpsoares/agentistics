/**
 * SessionActions — what you can do with ONE session, split into a MENU and a PANEL.
 *
 * It replaced a flat bar of eight buttons drawn under every card. A row is not a toolbar: the eight
 * verbs (`Answer its question`, `Send a prompt`, `Rename`, `Note`, `Task`, `Open whole task`,
 * `Finish task`, `Stop session`) now live behind a kebab MENU, and only the state's ONE lead action
 * stays on the row (decided by the pure `primaryAction`). The forms, the confirm, the dialog to
 * answer, the attach command and the result all render in the PANEL, inside the session's expanded
 * accordion.
 *
 * The rules the bar carried are kept, because they are what make this honest:
 *  - **A verb this row cannot take is DISABLED and refuses in a SENTENCE**, never silently inert —
 *    the row's own reason where it has one (`approveBlind` / `chooseBlind` / external note), the
 *    state word otherwise. A control that does nothing is indistinguishable from a broken one.
 *  - **A numbered dialog is never answered with a bare confirm.** The options are read off the
 *    session's own screen by the server and listed one button each; picking by number is enabled
 *    only where the server verified this harness can be answered that way.
 *  - **`Answer its question` is a HUMAN action.** A `waiting-approval` session is blocked on a
 *    person; nothing here answers for them. The person reads the dialog and picks.
 *  - **Attaching is a COMMAND, not a button** — it needs a real terminal a browser tab has not — so
 *    the panel hands over `agentop session attach <handle>` to copy.
 *
 * Nothing here decides availability. Every `enabled` flag and label arrives from `/api/fleet`, which
 * resolves them through the same `sessionActions` the terminal cockpit resolves every keypress
 * against — a second rule set here would be the bug `task-reopen.ts` exists to have fixed once.
 */

import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Copy, MoreVertical, Terminal, X } from 'lucide-react'
import { useIsMobile } from '../hooks/useIsMobile'
import { PERFORMABLE, TEXT_VERBS, type FleetActionId, type FleetRow, type FleetVerb } from '../lib/fleet'

const T = {
  pt: {
    menu: 'Ações da sessão',
    attach: 'Entrar nesta sessão pelo terminal:',
    attachWhy: 'Anexar precisa de um terminal de verdade — o navegador não tem um. Copie o comando.',
    copy: 'Copiar',
    copied: 'Copiado!',
    cancel: 'Cancelar',
    confirm: 'Confirmar',
    dialog: 'Esta sessão está esperando uma resposta de uma pessoa:',
    pick: 'Escolha uma opção:',
    notRunning: (state: string) => `Esta sessão não está rodando (${state}).`,
    notAsking: 'Esta sessão não está perguntando nada agora.',
    noReopen: 'Não há conversa para reabrir nesta linha.',
    external: 'Esta sessão não foi iniciada pelo agentop — nada aqui pode agir sobre ela.',
    noTask: 'Esta sessão não está em nenhuma tarefa.',
    working: 'Executando…',
    placeholder: {
      prompt: 'Uma linha para digitar nesta sessão…',
      rename: 'Novo nome para esta sessão…',
      note: 'Uma anotação sobre esta sessão…',
      task: 'A que tarefa esta sessão pertence…',
    } as Record<string, string>,
  },
  en: {
    menu: 'Session actions',
    attach: 'Enter this session from a terminal:',
    attachWhy: 'Attaching needs a real terminal and a browser tab has none. Copy the command.',
    copy: 'Copy',
    copied: 'Copied!',
    cancel: 'Cancel',
    confirm: 'Confirm',
    dialog: 'This session is waiting on a person to answer:',
    pick: 'Pick one:',
    notRunning: (state: string) => `This session is not running (${state}).`,
    notAsking: 'This session is not asking anything right now.',
    noReopen: 'There is no conversation to reopen on this row.',
    external: 'This session was not started by agentop — nothing here can act on it.',
    noTask: 'This session is not filed under any task.',
    working: 'Running…',
    placeholder: {
      prompt: 'One line to type into this session…',
      rename: 'A new name for this session…',
      note: 'A note about this session…',
      task: 'Which task this session belongs to…',
    } as Record<string, string>,
  },
}

/** Verbs that end work and are asked about before they run. */
const CONFIRM_VERBS: ReadonlySet<FleetActionId> = new Set<FleetActionId>(['kill'])

type ActFn = (req: { id: string; action: FleetActionId; text?: string; choice?: number })
  => Promise<{ ok: boolean; message: string }>

/**
 * The shared controller behind the menu and the panel. The card holds it so the kebab (on the
 * collapsed row) and the forms (in the expanded accordion) — two different places in the DOM — act
 * on one state.
 */
export interface SessionActionsController {
  row: FleetRow
  lang: 'pt' | 'en'
  active: FleetActionId | null
  busy: boolean
  msg: { ok: boolean; text: string } | null
  text: string
  setText: (s: string) => void
  /** Pick a verb (from the menu, or the primary button). Opens its form/confirm, or runs it. */
  pick: (v: FleetVerb) => void
  run: (action: FleetActionId, extra?: { text?: string; choice?: number }) => Promise<void>
  cancel: () => void
  refuse: (action: FleetActionId, reason?: string) => void
}

export function useSessionActionsController(row: FleetRow, lang: 'pt' | 'en', act: ActFn): SessionActionsController {
  const t = T[lang]
  const [active, setActive] = useState<FleetActionId | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function run(action: FleetActionId, extra?: { text?: string; choice?: number }) {
    setBusy(true)
    setMsg(null)
    const out = await act({ id: row.id, action, ...extra })
    setBusy(false)
    setActive(null)
    setText('')
    setMsg({ ok: out.ok, text: out.message })
  }

  /**
   * A disabled verb says WHY. The row's own sentence wins wherever it has one; the fallbacks are
   * per VERB, because "this session is not running" under a session plainly `working` is a wrong
   * sentence, and a wrong explanation is worse than a bare disabled button.
   */
  function refuse(action: FleetActionId, reason?: string) {
    if (reason) return setMsg({ ok: false, text: reason })
    if (row.state === 'unknown') return setMsg({ ok: false, text: t.external })
    if (action === 'openTask' || action === 'finishTask') return setMsg({ ok: false, text: t.noTask })
    if (action === 'approve') return setMsg({ ok: false, text: t.notAsking })
    if (action === 'resume') return setMsg({ ok: false, text: t.noReopen })
    setMsg({ ok: false, text: t.notRunning(row.stateLabel) })
  }

  function pick(v: FleetVerb) {
    setMsg(null)
    if (!(v.enabled && PERFORMABLE.has(v.action))) return refuse(v.action, v.reason)
    if (TEXT_VERBS.has(v.action)) {
      setText(v.action === 'rename' ? row.title : v.action === 'note' ? (row.note ?? '') : v.action === 'task' ? (row.task ?? '') : '')
      return setActive(v.action)
    }
    if (CONFIRM_VERBS.has(v.action)) return setActive(v.action)
    // `approve` shows the dialog, which the panel already draws whenever the row has one; just clear
    // any open form. Everything else (resume / openTask / finishTask) runs straight away.
    if (v.action === 'approve') return setActive(null)
    void run(v.action)
  }

  function cancel() { setActive(null); setText('') }

  return { row, lang, active, busy, msg, text, setText, pick, run, cancel, refuse }
}

// ---- the kebab MENU ------------------------------------------------------------------------------

function btnStyle(kind: 'plain' | 'danger' | 'primary', touch: number, isMobile: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: touch,
    padding: isMobile ? '0 14px' : '4px 10px',
    borderRadius: 8,
    fontSize: isMobile ? 13 : 11,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    border: kind === 'danger'
      ? '1px solid rgba(239,68,68,0.35)'
      : kind === 'primary' ? '1px solid var(--anthropic-orange)' : '1px solid var(--border)',
    background: kind === 'primary' ? 'var(--anthropic-orange)' : 'var(--bg-card)',
    color: kind === 'primary' ? '#fff' : kind === 'danger' ? '#ef4444' : 'var(--text-secondary)',
  }
}

/**
 * The kebab. All eight verbs in one place; the ones this row cannot take are dim and refuse by name.
 * Picking one runs it or opens its form in the panel (via the shared controller) — and calls
 * `onActivate`, which the card uses to open the accordion so whatever the pick produced is visible.
 */
export function SessionActionsMenu({ ctrl, onActivate }: { ctrl: SessionActionsController; onActivate: () => void }) {
  const t = T[ctrl.lang]
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const isMobile = useIsMobile()

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(v => !v)}
        title={t.menu}
        aria-label={t.menu}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: isMobile ? 40 : 30, height: isMobile ? 40 : 30, borderRadius: 8,
          border: open ? '1px solid var(--anthropic-orange)' : '1px solid var(--border-subtle)',
          background: open ? 'rgba(232,105,11,0.1)' : 'var(--bg-surface)',
          color: open ? 'var(--anthropic-orange)' : 'var(--text-secondary)',
          cursor: 'pointer', padding: 0,
        }}
      >
        <MoreVertical size={16} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 200,
            minWidth: 200, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
            borderRadius: 10, padding: 6, boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column', gap: 2,
          }}
        >
          {ctrl.row.verbs.map(v => {
            const live = v.enabled && PERFORMABLE.has(v.action)
            return (
              <button
                key={v.action}
                role="menuitem"
                title={live ? v.label : (v.reason ?? v.label)}
                onClick={() => { ctrl.pick(v); onActivate(); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: isMobile ? '11px 10px' : '7px 10px', borderRadius: 6, border: 'none',
                  background: 'transparent', cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'inherit', fontSize: isMobile ? 14 : 12, fontWeight: 500,
                  color: v.action === 'kill' ? '#ef4444' : 'var(--text-primary)',
                  opacity: live ? 1 : 0.4,
                }}
              >
                {v.action === 'kill' && <AlertTriangle size={13} style={{ flexShrink: 0 }} />}
                <span>{v.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---- the PANEL (forms / dialog / attach / result) ------------------------------------------------

/** Rendered inside the expanded accordion: the dialog to answer, the active verb's form, the attach
 *  command, and the last result. Never draws the verb buttons — those are in the menu. */
export function SessionActionsPanel({ ctrl }: { ctrl: SessionActionsController }) {
  const { row, lang, active, busy, msg, text, setText } = ctrl
  const t = T[lang]
  const isMobile = useIsMobile()
  const [copied, setCopied] = useState(false)
  const touch = isMobile ? 44 : 28
  const btn = (kind: 'plain' | 'danger' | 'primary') => btnStyle(kind, touch, isMobile)

  const killVerb = row.verbs.find(v => v.action === 'kill')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      {/* The dialog this session is blocked on, verbatim, and the options read off its own screen.
          Always shown when there is one — reading it is the whole of "Answer its question". */}
      {row.approvalLines && row.approvalLines.length > 0 && (
        <div
          style={{
            border: '1px solid rgba(232,105,11,0.35)',
            background: 'rgba(232,105,11,0.08)',
            borderRadius: 8, padding: '10px 12px',
            display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--anthropic-orange)' }}>{t.dialog}</div>
          <pre
            style={{
              margin: 0, fontSize: 11, lineHeight: 1.45, fontFamily: 'var(--font-mono, monospace)',
              color: 'var(--text-primary)', whiteSpace: 'pre', overflowX: 'auto', maxWidth: '100%',
            }}
          >
            {row.approvalLines.join('\n')}
          </pre>

          {row.dialogOptions && row.dialogOptions.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{t.pick}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {row.dialogOptions.map(o => {
                  // Picking by NUMBER exists only where the server said this harness has a verified
                  // way to do it. Elsewhere the options are still shown (reading them is what tells
                  // you what attaching is about to ask) and the buttons refuse by name.
                  const can = row.verbs.find(v => v.action === 'approve')?.enabled && !row.chooseBlind
                  return (
                    <button
                      key={o.number}
                      disabled={busy}
                      aria-disabled={!can}
                      onClick={() => (can ? ctrl.run('approve', { choice: o.number }) : ctrl.refuse('approve', row.chooseBlind))}
                      style={{ ...btn(can ? 'primary' : 'plain'), opacity: can ? 1 : 0.45 }}
                    >
                      <span style={{ fontWeight: 800 }}>{o.number}.</span>
                      <span style={{ fontWeight: 500 }}>{o.label}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* The inline form for whichever text verb is active. */}
      {active && TEXT_VERBS.has(active) && (
        <form
          onSubmit={e => { e.preventDefault(); if (text.trim()) void ctrl.run(active, { text }) }}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}
        >
          <input
            autoFocus
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={t.placeholder[active]}
            // No inline font-size: `index.css` guarantees >= 16px on mobile; overriding it here is
            // what makes iOS Safari zoom the viewport and break the sticky header.
            style={{
              flex: '1 1 220px', minWidth: 0, minHeight: touch, padding: '0 10px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--bg-elevated)',
              color: 'var(--text-primary)', fontFamily: 'inherit', outline: 'none',
            }}
          />
          <button type="submit" disabled={busy || !text.trim()} style={{ ...btn('primary'), opacity: busy || !text.trim() ? 0.5 : 1 }}>
            <Check size={13} /> {busy ? t.working : t.confirm}
          </button>
          <button type="button" onClick={ctrl.cancel} style={btn('plain')}>
            <X size={13} /> {t.cancel}
          </button>
        </form>
      )}

      {/* The confirm for a destructive verb (Stop session). */}
      {active && CONFIRM_VERBS.has(active) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#ef4444' }}>
            <AlertTriangle size={13} /> {killVerb?.label} — {row.title}
          </span>
          <button disabled={busy} onClick={() => void ctrl.run(active)} style={btn('danger')}>
            <Check size={13} /> {busy ? t.working : t.confirm}
          </button>
          <button onClick={ctrl.cancel} style={btn('plain')}>
            <X size={13} /> {t.cancel}
          </button>
        </div>
      )}

      {/* Attaching, as the command that does it. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }} title={t.attachWhy}>{t.attach}</span>
        <code
          style={{
            fontSize: 11, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary)',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6,
            padding: '4px 8px', overflowX: 'auto', maxWidth: '100%', whiteSpace: 'nowrap',
          }}
        >
          {row.attachCommand}
        </code>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(row.attachCommand)
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          }}
          style={btn('plain')}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? t.copied : t.copy}
        </button>
        <Terminal size={12} style={{ color: 'var(--text-tertiary)' }} />
      </div>

      {/* Whatever the last press said — a success, or the refusal that names why it could not run. */}
      {msg && (
        <div
          role="status"
          style={{
            fontSize: 12, lineHeight: 1.5, padding: '6px 10px', borderRadius: 8,
            background: msg.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border: msg.ok ? '1px solid rgba(34,197,94,0.25)' : '1px solid rgba(239,68,68,0.25)',
            color: msg.ok ? '#22c55e' : '#ef4444', wordBreak: 'break-word',
          }}
        >
          {msg.text}
        </div>
      )}
    </div>
  )
}
