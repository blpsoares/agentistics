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

import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
// A single newline is a LINE BREAK here. Without this plugin markdown collapses it to a space, so a
// message written across several lines renders as one run-on paragraph — which is what "the
// messages are not formatted" turned out to mean. `HarnessChat` has always used it.
import remarkBreaks from 'remark-breaks'
import { CornerUpLeft, User } from 'lucide-react'
import { HARNESS_COLORS, HARNESS_LABELS } from '../../lib/harness'
import { splitImageAttachments } from '../../lib/attachmentPreview'
import { attachmentUrl } from '../../lib/attachmentUrl'
import { AttachmentLightbox } from './AttachmentLightbox'
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
  /**
   * Quote THIS turn in the composer. Absent where the session cannot be written to — a reply
   * control on a row that will refuse the message is a control that teaches the wrong thing.
   *
   * Takes the turn rather than closing over it, so the PARENT can hand every bubble the SAME
   * function reference (one `useCallback`, not one closure per row) — the memo above only pays off
   * if `onReply` is actually stable across a re-render caused by something unrelated, like typing.
   */
  onReply?: (turn: ChatTurn) => void
}

/**
 * Memoized: a long conversation renders hundreds of these, and every one of them re-rendered on
 * every keystroke in the composer, because `draft` lives in the same component as the turns list —
 * a state change anywhere re-renders every child unless the child says it doesn't need to. That is
 * what "typing is slow and stuck" turned out to mean on a session with a real amount of history.
 * `onReply` is a fresh closure per render in the parent, so this alone would not have been enough —
 * see `SessionChat.tsx`'s `useCallback` on it.
 */
export const ChatBubble = memo(function ChatBubble({ turn, lang, harness, provisional, onReply }: ChatBubbleProps) {
  const pt = lang === 'pt'
  const mine = turn.role === 'user'
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  // An attachment is a PATH the composer typed into the pane (see `attachmentPreview.ts`'s header),
  // so it arrives in `turn.text` like any other line — pulled out here rather than at the source, so
  // the SAME rule reads an echoed message and its later transcript copy identically.
  const { images, text } = splitImageAttachments(turn.text)

  // A turn that said nothing AND attached nothing is not a message. Tool calls and reasoning are
  // the work between messages, and the row's state already reports that the session is working.
  if (text.trim() === '' && images.length === 0) return null

  const color = (HARNESS_COLORS as Record<string, string>)[harness] ?? 'var(--text-secondary)'
  const name = (HARNESS_LABELS as Record<string, string>)[harness] ?? harness

  return (
    <div className="ag-bubble" style={{
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
        borderRadius: 14, padding: '11px 14px', position: 'relative',
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

        {/* Reply. Revealed with the bubble rather than standing on every message — a column of
            controls down a conversation competes with the words. Always reachable by keyboard. */}
        {onReply && !provisional && (
          <button
            className="ag-bubble-reply"
            onClick={() => onReply(turn)}
            aria-label={pt ? 'Responder' : 'Reply'}
            title={pt ? 'Responder' : 'Reply'}
            style={{
              position: 'absolute', top: 6, [mine ? 'left' : 'right']: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 7, cursor: 'pointer',
              border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)',
              color: 'var(--text-tertiary)', opacity: 0, transition: 'opacity 0.15s',
            } as React.CSSProperties}
          >
            <CornerUpLeft size={12} />
          </button>
        )}

        {/* Small squares ABOVE the text — what was attached, rendered rather than left as a bare
            path nobody can read at a glance. Absent rows carry no rule of their own: an image that
            fails to load (moved, or outside `ATTACHMENT_DIR`) falls back to a plain chip with its
            name, never a broken-image icon with nothing to click. */}
        {images.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {images.map((path, i) => (
              <AttachmentThumb key={path} path={path} onOpen={() => setLightboxIndex(i)} />
            ))}
          </div>
        )}

        {text.trim() !== '' && (
          <div
            className="ag-chat-md"
            style={{
              // The base is inline as well as in the sheet: a bubble whose stylesheet failed should
              // still read as a message rather than as unstyled 14px page text.
              minWidth: 0, overflowWrap: 'anywhere',
              fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-primary)',
            }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{text}</ReactMarkdown>
          </div>
        )}
      </div>

      {lightboxIndex !== null && (
        <AttachmentLightbox
          paths={images}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          lang={lang}
        />
      )}
    </div>
  )
})

/** One attachment, as a small square. Falls back to a plain chip when the image fails to load. */
function AttachmentThumb({ path, onOpen }: { path: string; onOpen: () => void }) {
  const [broken, setBroken] = useState(false)
  const name = path.split('/').pop() ?? path

  if (broken) {
    return (
      <span
        title={path}
        style={{
          display: 'inline-flex', alignItems: 'center', maxWidth: 160,
          padding: '5px 8px', borderRadius: 8, minWidth: 0,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          fontSize: 11, color: 'var(--text-tertiary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
    )
  }

  return (
    <button
      onClick={onOpen}
      title={name}
      aria-label={name}
      style={{
        display: 'block', width: 72, height: 72, padding: 0, borderRadius: 9, overflow: 'hidden',
        border: '1px solid var(--border-subtle)', cursor: 'pointer', flexShrink: 0,
        background: 'var(--bg-elevated)',
      }}
    >
      <img
        src={attachmentUrl(path)}
        alt=""
        onError={() => setBroken(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </button>
  )
}
