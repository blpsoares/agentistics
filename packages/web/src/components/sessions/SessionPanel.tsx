/**
 * SessionPanel — one selected session, as a terminal or as a conversation.
 *
 * The two views answer different questions and neither replaces the other. The TERMINAL is the
 * whole truth: everything the assistant draws, tool output included, and the only place a dialog
 * can be answered. The CHAT is the readable half: what was actually said, with the box drawing and
 * the status strip gone.
 *
 * So the toggle is per session and it defaults to CHAT where a chat can exist and to TERMINAL where
 * it cannot. Where it cannot, the Chat segment is ABSENT rather than disabled — a control that is
 * present and refuses teaches nothing, while its absence plus the sentence in the panel says which
 * harnesses can do this and why yours cannot.
 */

import { useState } from 'react'
import { MessagesSquare, Square, TerminalSquare } from 'lucide-react'
import type { ControlSession } from '@agentistics/tui/control/session-fleet'
import type { FleetActionId, FleetRow } from '../../lib/fleet'
import { TerminalRegion } from '../RecentSessions'
import { SessionChat } from './SessionChat'
import { SessionActions } from './SessionActions'

export type SessionView = 'chat' | 'terminal'

export interface SessionPanelProps {
  session: ControlSession
  /** The shaped row, for the terminal's own composer and verb list. */
  row?: FleetRow
  lang: 'pt' | 'en'
  theme: 'dark' | 'light'
  act: (req: { id: string; action: FleetActionId; text?: string; choice?: number })
    => Promise<{ ok: boolean; message: string }>
  authorName?: string
  /** Called after a verb that removes the row — the panel has nothing left to show. */
  onGone?: () => void
}

export function SessionPanel({ session, row, lang, theme, act, authorName, onGone }: SessionPanelProps) {
  const pt = lang === 'pt'

  /**
   * Can this session be read as a conversation at all?
   *
   * `conversationBlind` is the row's own sentence for a harness that can never report which
   * conversation it is writing. Reused rather than re-derived: the row, the chat view and this
   * toggle must give one answer, and this is the one place that could quietly disagree.
   */
  const chattable = session.conversationBlind === undefined
  const stopVerb = row?.verbs.find(v => v.action === 'interrupt')

  const [view, setView] = useState<SessionView>(chattable ? 'chat' : 'terminal')
  const active: SessionView = chattable ? view : 'terminal'

  return (
    // `flex: 1` + `minHeight: 0`, NOT `height: 100%`. In a column flex container a percentage
    // height on an item that is itself being flexed does not reliably resolve, and when it does not
    // the scroll container inside grows to its content instead of scrolling — which is the single
    // cause of two reported bugs: the conversation opening at the top (scrollTop on a non-scrolling
    // element does nothing) and the jump-to-latest arrow never appearing (`scrollHeight` equals
    // `clientHeight`, so the reader always measures as "at the tail").
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* PINNED. `flexShrink: 0` keeps it out of the flex squeeze and the pane below owns the
          scrolling, so the title and the view switch stay put however long the conversation runs.
          They are what you need to know and what you need to reach at any point in it. */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        flexShrink: 0, minWidth: 0, position: 'relative', zIndex: 2,
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{
            margin: 0, fontSize: 15, fontWeight: 650, color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {session.title}
          </h1>
          <p style={{
            margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-tertiary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {session.stateLabel}
            {session.task ? ` · ${session.task}` : ''}
            {session.project ? ` · ${session.project}` : ''}
          </p>
        </div>

        {/* The toggle. Only rendered when there are two views to choose between — a segmented
            control with one segment is a label pretending to be a control. */}
        {chattable && (
          <div role="tablist" style={{
            display: 'flex', gap: 3, padding: 3, borderRadius: 10, flexShrink: 0,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          }}>
            <Segment
              on={active === 'chat'} onClick={() => setView('chat')}
              icon={<MessagesSquare size={14} />} label={pt ? 'Conversa' : 'Chat'}
            />
            <Segment
              on={active === 'terminal'} onClick={() => setView('terminal')}
              icon={<TerminalSquare size={14} />} label={pt ? 'Terminal' : 'Terminal'}
            />
          </div>
        )}

        {/* Stop what it is doing, WITHOUT ending it. Its own control rather than an item in the
            menu, because it is the one thing you reach for while watching a session run — and a
            verb you want in a hurry does not belong two clicks deep. Absent unless the row can take
            it, since a stop button on an idle session would send Escape into its prompt. */}
        {stopVerb?.enabled && (
          <button
            onClick={() => void act({ id: session.id, action: 'interrupt' })}
            title={stopVerb.label}
            aria-label={stopVerb.label}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
              minHeight: 32, padding: '0 11px', borderRadius: 9, cursor: 'pointer',
              border: '1px solid color-mix(in srgb, var(--accent-red) 45%, transparent)',
              background: 'color-mix(in srgb, var(--accent-red) 12%, transparent)',
              color: 'var(--accent-red)', fontFamily: 'inherit', fontSize: 12, fontWeight: 650,
            }}
          >
            <Square size={11} fill="currentColor" />
            {pt ? 'Parar' : 'Stop'}
          </button>
        )}

        {/* The row's verbs. Every one of them, its label and whether it is enabled arrive already
            decided by `sessionActions` — the same answer the terminal cockpit resolves against. */}
        {row && (
          <SessionActions
            row={row}
            lang={lang}
            act={act}
            {...(onGone ? { onGone } : {})}
          />
        )}
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {active === 'chat' ? (
          <SessionChat session={session} {...(row ? { row } : {})} lang={lang} act={act} />
        ) : (
          <div style={{ flex: 1, minHeight: 0, padding: 16, display: 'flex', flexDirection: 'column' }}>
            {/* The very component the sessions list uses. Assembling a second one from the stream
                hook, the emulator and a composer would be three things that must agree about
                reconnects, stalls, zoom and the consent gate on typing into a live session. */}
            <TerminalRegion
              id={session.id}
              theme={theme}
              lang={lang}
              fill
              {...(row ? { row } : {})}
              act={act}
              {...(authorName ? { authorName } : {})}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function Segment({ on, onClick, icon, label }: {
  on: boolean; onClick: () => void; icon: React.ReactNode; label: string
}) {
  return (
    <button
      role="tab"
      aria-selected={on}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        minHeight: 30, padding: '0 10px', borderRadius: 8, border: 'none',
        cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: on ? 700 : 500,
        whiteSpace: 'nowrap',
        background: on ? 'var(--bg-surface)' : 'transparent',
        color: on ? 'var(--text-primary)' : 'var(--text-tertiary)',
        boxShadow: on ? 'var(--ag-shadow-seg)' : 'none',
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {icon}
      {label}
    </button>
  )
}
