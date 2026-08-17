/**
 * SessionActionBar — what you can do with ONE session, in the browser.
 *
 * It replaced a column of checkboxes plus a floating "N selected" bar. The checkboxes were a
 * selection model over rows that mostly cannot take the same verb: half a page of stored
 * conversations, one live session and one assistant agentop never started are not a set anything
 * can be done to at once, and the bar offered kill / reopen / prompt to all of them equally
 * — against endpoints that did not exist, so every one of those buttons was silently inert.
 *
 * The shape is the cockpit's, and deliberately so:
 *
 *  - **Every verb is always drawn, and the ones this row cannot take are DISABLED.** The rule
 *    elsewhere in this product is that an impossible action is absent; here that is wrong, for the
 *    reason `sessionActions` records — a fleet agentop did not start would shrink the bar from
 *    seven buttons to one, and a menu that lost six items reads as a broken feature. Absence
 *    communicates nothing about WHY.
 *  - **A disabled verb refuses in a SENTENCE.** Clicking one states the reason (the row's own
 *    `approveBlind` / `chooseBlind` / external note where it has one, the state word otherwise).
 *    A control that is silently inert is indistinguishable from a broken one.
 *  - **A numbered dialog is never answered with a bare confirm.** The options are read off the
 *    session's own screen by the server and listed here one button each; "answer its question" is
 *    enabled only where the server said a bare confirm is the whole of the question.
 *  - **Attaching is a COMMAND, not a button.** It needs a real terminal, and a browser tab has
 *    none — so the row hands over `agentop session attach <handle>` to copy.
 *
 * Nothing here decides availability. Every `enabled` flag and every label arrives from
 * `/api/fleet`, which resolves them through the same pure `sessionActions` the terminal cockpit
 * resolves every keypress against.
 */

import React, { useState } from 'react'
import { AlertTriangle, Check, Copy, Terminal, X } from 'lucide-react'
import { useIsMobile } from '../hooks/useIsMobile'
import { PERFORMABLE, TEXT_VERBS, type FleetActionId, type FleetRow } from '../lib/fleet'

const T = {
  pt: {
    heading: 'O que fazer com esta sessão',
    attach: 'Entrar nesta sessão pelo terminal:',
    attachWhy: 'Anexar precisa de um terminal de verdade — o navegador não tem um. Copie o comando.',
    copy: 'Copiar',
    copied: 'Copiado!',
    cancel: 'Cancelar',
    confirm: 'Confirmar',
    dialog: 'Esta sessão está esperando uma resposta:',
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
    heading: 'What to do with this session',
    attach: 'Enter this session from a terminal:',
    attachWhy: 'Attaching needs a real terminal and a browser tab has none. Copy the command.',
    copy: 'Copy',
    copied: 'Copied!',
    cancel: 'Cancel',
    confirm: 'Confirm',
    dialog: 'This session is waiting on an answer:',
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

export function SessionActionBar({
  row,
  lang,
  act,
}: {
  row: FleetRow
  lang: 'pt' | 'en'
  act: (req: { id: string; action: FleetActionId; text?: string; choice?: number })
    => Promise<{ ok: boolean; message: string }>
}) {
  const t = T[lang]
  const isMobile = useIsMobile()
  // Which verb has the inline form open. One at a time: two open forms are two things the Enter
  // key could mean.
  const [open, setOpen] = useState<FleetActionId | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // 44px is the MOBILE number. Applying it on desktop turns a row of small verbs into a stack of
  // bars — the same distinction the settings primitives make.
  const touch = isMobile ? 44 : 28

  async function run(action: FleetActionId, extra?: { text?: string; choice?: number }) {
    setBusy(true)
    setMsg(null)
    const out = await act({ id: row.id, action, ...extra })
    setBusy(false)
    setOpen(null)
    setText('')
    setMsg({ ok: out.ok, text: out.message })
  }

  /**
   * A disabled verb says WHY.
   *
   * The row's own sentence wins wherever it has one — those are the findings, per harness, that
   * nothing else on the page can state ("nobody has read this harness's dialog", "this one cannot
   * be answered by number"). The fallbacks below are per VERB rather than one sentence for all of
   * them: "this session is not running" under a session plainly marked `working` is a wrong
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

  const btn = (kind: 'plain' | 'danger' | 'primary'): React.CSSProperties => ({
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
  })

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        paddingTop: 10,
        borderTop: '1px solid var(--border-subtle)',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: 0.2 }}>
        {t.heading}
      </div>

      {/* The dialog this session is blocked on, verbatim, and the options read off its own screen.
          Shown BEFORE the verbs, because it is what has to be read before any of them is pressed. */}
      {row.approvalLines && row.approvalLines.length > 0 && (
        <div
          style={{
            border: '1px solid rgba(232,105,11,0.35)',
            background: 'rgba(232,105,11,0.08)',
            borderRadius: 8,
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minWidth: 0,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--anthropic-orange)' }}>{t.dialog}</div>
          <pre
            style={{
              margin: 0,
              fontSize: 11,
              lineHeight: 1.45,
              fontFamily: 'var(--font-mono, monospace)',
              color: 'var(--text-primary)',
              whiteSpace: 'pre',
              overflowX: 'auto',
              maxWidth: '100%',
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
                  // way to do it. Everywhere else the options are still shown — reading them is what
                  // tells you what attaching is about to ask — and the buttons refuse by name.
                  const can = row.verbs.find(v => v.action === 'approve')?.enabled && !row.chooseBlind
                  return (
                    <button
                      key={o.number}
                      disabled={busy}
                      aria-disabled={!can}
                      onClick={() => (can ? run('approve', { choice: o.number }) : refuse('approve', row.chooseBlind))}
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

      {/* The verbs. Always all of them; the ones this row cannot take are dim and say why. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
        {row.verbs.map(v => {
          const performable = PERFORMABLE.has(v.action)
          const live = v.enabled && performable
          // A verb that needs a line of text opens a form; the rest run (or ask) straight away.
          const onClick = () => {
            if (!live) return refuse(v.action, v.reason)
            if (TEXT_VERBS.has(v.action)) {
              setMsg(null)
              setText(v.action === 'rename' ? row.title : v.action === 'note' ? (row.note ?? '') : v.action === 'task' ? (row.task ?? '') : '')
              return setOpen(open === v.action ? null : v.action)
            }
            if (CONFIRM_VERBS.has(v.action)) { setMsg(null); return setOpen(open === v.action ? null : v.action) }
            void run(v.action)
          }
          return (
            <button
              key={v.action}
              disabled={busy}
              aria-disabled={!live}
              title={live ? v.label : (v.reason ?? v.label)}
              onClick={onClick}
              style={{
                ...btn(v.action === 'kill' ? 'danger' : open === v.action ? 'primary' : 'plain'),
                opacity: live ? 1 : 0.4,
              }}
            >
              {v.label}
            </button>
          )
        })}
      </div>

      {/* The inline form for whichever verb asked for one. */}
      {open && TEXT_VERBS.has(open) && (
        <form
          onSubmit={e => { e.preventDefault(); if (text.trim()) void run(open, { text }) }}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}
        >
          <input
            autoFocus
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={t.placeholder[open]}
            // No inline font-size: `index.css` guarantees >= 16px on mobile, and overriding it here
            // is what makes iOS Safari zoom the viewport and break the sticky header.
            style={{
              flex: '1 1 220px',
              minWidth: 0,
              minHeight: touch,
              padding: '0 10px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <button type="submit" disabled={busy || !text.trim()} style={{ ...btn('primary'), opacity: busy || !text.trim() ? 0.5 : 1 }}>
            <Check size={13} /> {busy ? t.working : t.confirm}
          </button>
          <button type="button" onClick={() => { setOpen(null); setText('') }} style={btn('plain')}>
            <X size={13} /> {t.cancel}
          </button>
        </form>
      )}

      {open && CONFIRM_VERBS.has(open) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#ef4444' }}>
            <AlertTriangle size={13} /> {row.verbs.find(v => v.action === open)?.label} — {row.title}
          </span>
          <button disabled={busy} onClick={() => void run(open)} style={btn('danger')}>
            <Check size={13} /> {busy ? t.working : t.confirm}
          </button>
          <button onClick={() => setOpen(null)} style={btn('plain')}>
            <X size={13} /> {t.cancel}
          </button>
        </div>
      )}

      {/* Attaching, as the command that does it. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }} title={t.attachWhy}>{t.attach}</span>
        <code
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono, monospace)',
            color: 'var(--text-primary)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            padding: '4px 8px',
            overflowX: 'auto',
            maxWidth: '100%',
            whiteSpace: 'nowrap',
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

      {/* Whatever the last press said — a success, or the refusal that names why it could not run.
          `role="status"` so it is announced rather than merely drawn. */}
      {msg && (
        <div
          role="status"
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            padding: '6px 10px',
            borderRadius: 8,
            background: msg.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            border: msg.ok ? '1px solid rgba(34,197,94,0.25)' : '1px solid rgba(239,68,68,0.25)',
            color: msg.ok ? '#22c55e' : '#ef4444',
            wordBreak: 'break-word',
          }}
        >
          {msg.text}
        </div>
      )}
    </div>
  )
}
