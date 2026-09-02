/**
 * ChatBubble — one turn of a session's conversation.
 *
 * IT SHOWS WHAT WAS SAID, AND NOTHING ELSE. The transcript also carries the assistant's reasoning
 * and every tool call it made, and an earlier pass rendered both. It was wrong: a session that runs
 * forty commands produces forty entries nobody asked to read, and the two or three sentences that
 * were actually addressed to the user are lost in them. The reasoning is not a message either — it
 * is the assistant thinking, which the terminal view shows in full for anyone who wants it.
 *
 * So a turn with no text renders NOTHING. A turn that is only tool calls is work in progress, and
 * the state on the row already says the session is working.
 *
 * Both sides get a surface. An assistant turn rendered as bare text on the page background reads as
 * the page itself talking; the two sides are told apart by alignment and colour rather than by one
 * having a box and the other not.
 *
 * WIDE CONTENT SCROLLS INSIDE ITS OWN BOX. A code fence, a table or a long URL is routinely wider
 * than the bubble, and letting it set the width is how a message ends up outside its own card.
 */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
// A single newline is a LINE BREAK here. Without this plugin markdown collapses it to a space, so a
// message written across several lines renders as one run-on paragraph — which is what "the
// messages are not formatted" turned out to mean. `HarnessChat` has always used it.
import remarkBreaks from 'remark-breaks'
import { User } from 'lucide-react'
import { HARNESS_COLORS, HARNESS_LABELS } from '../../lib/harness'
import { HarnessMark } from './HarnessMark'

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
  pending?: boolean
  /** Carried by the transcript; deliberately not rendered here. See the header. */
  tools?: Array<{ name: string; detail?: string }>
  /** Carried by the transcript; deliberately not rendered here. See the header. */
  thinking?: string
}

export interface ChatBubbleProps {
  turn: ChatTurn
  lang: 'pt' | 'en'
  /** Which assistant said it, for the mark beside an assistant turn. */
  harness: string
  /** Read off the terminal screen and not yet committed to the transcript. Labelled as such. */
  provisional?: boolean
}

export function ChatBubble({ turn, lang, harness, provisional }: ChatBubbleProps) {
  const pt = lang === 'pt'
  const mine = turn.role === 'user'

  // A turn that said nothing is not a message. Tool calls and reasoning are the work between
  // messages, and the row's state already reports that the session is working.
  if (turn.text.trim() === '') return null

  const color = (HARNESS_COLORS as Record<string, string>)[harness] ?? 'var(--text-secondary)'
  const name = (HARNESS_LABELS as Record<string, string>)[harness] ?? harness

  return (
    <div style={{
      display: 'flex', gap: 10, minWidth: 0,
      flexDirection: mine ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
    }}>
      {mine ? (
        <span
          aria-hidden
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            width: 26, height: 26, borderRadius: 7, marginTop: 2,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            color: 'var(--text-tertiary)',
          }}
        >
          <User size={13} />
        </span>
      ) : (
        <span style={{ marginTop: 2, display: 'flex' }}>
          <HarnessMark harness={harness} />
        </span>
      )}

      <div style={{
        // `minWidth: 0` is what actually keeps wide content inside the card: without it a flex item
        // refuses to shrink below its content, and a long line pushes the bubble off the pane.
        minWidth: 0, maxWidth: mine ? '82%' : '100%',
        display: 'flex', flexDirection: 'column', gap: 6,
        background: mine ? 'var(--bg-elevated)' : 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 14, padding: '11px 14px',
      }}>
        {!mine && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
            color: provisional ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
          }}>
            <span style={{ color }}>{name}</span>
            {provisional && (
              <>
                <span style={{ opacity: 0.4 }}>·</span>
                {/* Said in words: this text was read off a terminal screen, and the transcript's
                    own version replaces it the moment the turn lands. */}
                <span>{pt ? 'escrevendo — lido da tela' : 'writing — read from the screen'}</span>
              </>
            )}
          </div>
        )}

        <div
          className="ag-chat-md"
          style={{
            // The base is inline as well as in the sheet: a bubble whose stylesheet failed should
            // still read as a message rather than as unstyled 14px page text.
            minWidth: 0, overflowWrap: 'anywhere',
            fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-primary)',
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{turn.text}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
