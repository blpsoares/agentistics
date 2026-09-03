/**
 * SessionChat — one live session, read as a conversation.
 *
 * TWO SOURCES, each used for what it is good at, because neither can do the whole job:
 *
 * - The TRANSCRIPT (`/api/fleet/chat`) is the truth — role-tagged, complete, exactly what the
 *   assistant wrote. It arrives per TURN, because Claude writes a message to its JSONL once the
 *   message is finished. It can never stream token by token.
 * - The FRAME (`/api/fleet/stream`, captured twice a second) is live — it is the terminal, and the
 *   text appears on it as it is produced. But it is a rendered TUI, wrapped to the pane width with
 *   a status strip and an input box in it.
 *
 * So completed turns are bubbles from the transcript, and the turn IN FLIGHT is drawn from the
 * frame and replaced by the transcript's version the moment it lands. The live bubble is labelled
 * as read-from-the-screen and never becomes history: a misread frame is corrected within seconds,
 * while a misread turn kept as history would be wrong forever.
 *
 * A SENT MESSAGE IS ECHOED IMMEDIATELY. It reaches the session the instant it is typed into the
 * pane, but it only enters the transcript when the harness writes it, which is a poll or two later
 * — so pressing enter appeared to do nothing while the message had in fact been delivered. That was
 * reported. The echo is dropped as soon as the transcript carries the same text, so it can never
 * become a duplicate or survive a send that silently failed.
 *
 * WHERE IT CANNOT EXIST IT SAYS SO. The link from a live session to its transcript is exact only
 * for Claude Code, which names our tmux session in its own record. Everywhere else the server
 * refuses in words rather than showing some other conversation from the same directory under this
 * session's name — a confident wrong answer the reader has no way to detect.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ChevronUp, Loader, Mic, Paperclip, RotateCcw, Send, Square, X } from 'lucide-react'
import type { ControlSession } from '@agentistics/tui/control/session-fleet'
import type { FleetActionId, FleetRow } from '../../lib/fleet'
import { ApprovalCard } from './ApprovalCard'
import { ChatBubble, type ChatTurn } from './ChatBubble'
import { WorkingNote } from './WorkingNote'
import { useTerminalStream } from '../../hooks/useTerminalStream'
import { isImagePath } from '../../lib/attachmentPreview'
import { attachmentUrl } from '../../lib/attachmentUrl'
import { liveTurnText, stripAnsi } from '../../lib/liveTurn'
import { MAX_ATTACHMENTS, attachmentRoom, planPaste } from '../../lib/pastePlan'
import { dictationLocale, dictationSupport } from '../../lib/dictation'
import { modelSwitchLine, modelSwitchReason } from '../../lib/modelSwitch'

interface ChatPayload {
  turns: ChatTurn[]
  unavailable?: string
  live: boolean
}

export interface SessionChatProps {
  session: ControlSession
  /** The shaped row, which carries the parsed dialog and what may be done about it. */
  row?: FleetRow
  lang: 'pt' | 'en'
  act: (req: { id: string; action: FleetActionId; text?: string; choice?: number })
    => Promise<{ ok: boolean; message: string }>
}

/** Matches the fleet poll. The transcript only changes when a turn lands, so faster buys nothing. */
const CHAT_POLL_MS = 3000

/** How tall the composer's field may grow before it scrolls internally instead. */
const TEXTAREA_MAX_HEIGHT = 140

/**
 * How far from the bottom still counts as "at the tail", in px.
 *
 * Kept small on purpose: a working session's live terminal frame re-renders this view on every
 * frame the SSE channel delivers (`useTerminalStream`), and each one re-runs the follow effect
 * below. At the old 120px, scrolling up by less than one ordinary message bubble still read as
 * "at the tail" — so the very next frame yanked the reader straight back down mid-reply, which is
 * exactly the thing this whole mechanism exists to prevent.
 */
const TAIL_SLACK = 24

interface Attachment { name: string; path: string }

export function SessionChat({ session, row, lang, act }: SessionChatProps) {
  const pt = lang === 'pt'
  const [payload, setPayload] = useState<ChatPayload | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  /** Dictation. `recognitionRef` holds the live recogniser so a second click stops it. */
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<{ stop: () => void } | null>(null)
  const dictation = useMemo(
    () => dictationSupport(typeof window === 'undefined' ? undefined : (window as never), pt ? 'pt' : 'en'),
    [pt],
  )
  /** The composer's "more options" menu — dictation and the model live in it. */
  const [moreOpen, setMoreOpen] = useState(false)
  /** The menu AND its button, so an outside-click handler can tell "inside" from "outside". */
  const moreMenuRef = useRef<HTMLDivElement | null>(null)

  /**
   * Start or stop dictation.
   *
   * The recognised text is APPENDED to the draft and nothing is sent: what reaches the session is
   * still what the user chose to send, exactly as if they had typed it. No audio leaves the
   * browser — the recognition is the browser's own, and this product uploads nothing.
   */
  const toggleDictation = useCallback(() => {
    if (listening) { recognitionRef.current?.stop(); return }
    const w = window as unknown as { SpeechRecognition?: new () => never; webkitSpeechRecognition?: new () => never }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) return
    try {
      const rec = new Ctor() as unknown as {
        lang: string; continuous: boolean; interimResults: boolean
        start: () => void; stop: () => void
        onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
        onend: (() => void) | null
        onerror: (() => void) | null
      }
      rec.lang = dictationLocale(pt ? 'pt' : 'en')
      rec.continuous = true
      rec.interimResults = false
      rec.onresult = e => {
        let text = ''
        for (let i = 0; i < e.results.length; i++) text += e.results[i]?.[0]?.transcript ?? ''
        if (!text.trim()) return
        // Appended with a separating space rather than replacing: somebody may have typed half a
        // sentence before reaching for the microphone.
        setDraft(d => (d.trim() === '' ? text.trim() : `${d.replace(/\s+$/, '')} ${text.trim()}`))
      }
      // Both end the same way. A recogniser that stopped on its own (a timeout, a denied
      // permission) must not leave the button lit — a control that says it is listening when it
      // is not is worse than one that never started.
      rec.onend = () => { setListening(false); recognitionRef.current = null }
      rec.onerror = () => { setListening(false); recognitionRef.current = null }
      rec.start()
      recognitionRef.current = rec
      setListening(true)
    } catch {
      setListening(false)
    }
  }, [listening, pt])

  // A click anywhere else closes the model menu. Requiring a second click on the button is the
  // behaviour of a toggle, and a dropdown is not one — every menu in this app and every menu the
  // reader has used elsewhere dismisses on an outside click, so needing to find the button again
  // reads as the menu being stuck. `mousedown` rather than `click`, so it closes on the press
  // instead of waiting for a release that may land somewhere else.
  useEffect(() => {
    if (!moreOpen) return
    const close = (e: MouseEvent) => {
      // A click INSIDE the menu (picking a model) must not be eaten by this — that path closes the
      // menu itself, and closing here first would cancel the pick.
      if (moreMenuRef.current?.contains(e.target as Node)) return
      setMoreOpen(false)
    }
    document.addEventListener('mousedown', close)
    // Escape too: a menu that can only be dismissed with the mouse is one a keyboard cannot leave.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  // A recogniser left running after this panel unmounts keeps the tab's microphone indicator on
  // for a session nobody is looking at.
  useEffect(() => () => { recognitionRef.current?.stop() }, [])

  /**
   * The models this harness offers, from `/api/fleet/new` — the SAME source the New session wizard
   * reads, so the two lists cannot disagree about what a harness accepts. Fetched once when the
   * picker is first opened rather than on mount: most sessions are read, not re-modelled.
   */
  const [modelSuggestions, setModelSuggestions] = useState<string[]>([])
  const modelReason = useMemo(() => modelSwitchReason(row?.harness ?? '', pt ? 'pt' : 'en'), [row, pt])
  useEffect(() => {
    if (modelReason || !row?.harness) return
    let alive = true
    fetch(`/api/fleet/new?lang=${pt ? 'pt' : 'en'}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: { harnesses?: { id: string; modelSuggestions?: string[] }[] } | null) => {
        if (!alive || !d?.harnesses) return
        setModelSuggestions(d.harnesses.find(h => h.id === row.harness)?.modelSuggestions ?? [])
      })
      .catch(() => { /* no list, no picker — the control simply does not appear */ })
    return () => { alive = false }
  }, [row?.harness, modelReason, pt])

  /** Switch the model mid-conversation by TYPING the harness's own command — see modelSwitch.ts. */
  const switchModel = useCallback(async (model: string) => {
    const line = modelSwitchLine(row?.harness ?? '', model)
    setMoreOpen(false)
    if (!line) return
    await act({ id: row!.id, action: 'prompt', text: line })
  }, [row, act])

  const [notice, setNotice] = useState<string | null>(null)
  const [atTail, setAtTail] = useState(true)
  /** Messages sent from here and not yet seen in the transcript. See the header. */
  const [echo, setEcho] = useState<string[]>([])
  /**
   * The message being replied to.
   *
   * There is no reply THREAD to send: the transport types a line into a pane, and these CLIs have
   * one linear conversation. So a reply is a QUOTE — the quoted lines are prefixed with `> ` and
   * sent above what you write, which is what the assistant will actually see and is the same thing
   * mail has always done. Saying it plainly beats a UI that implies threading the session cannot do.
   */
  const [replyTo, setReplyTo] = useState<{ role: 'user' | 'assistant'; text: string } | null>(null)
  /**
   * Files written to THIS MACHINE, whose paths go into the message.
   *
   * That is what an attachment can be here: the composer types a line into a tmux pane, so there is
   * no channel a byte array could travel down — but every one of these CLIs reads a file it is
   * pointed at. The chip says the name; the message carries the path.
   */
  const [attached, setAttached] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** Has this conversation been placed at its end yet? Opening mid-history is disorienting. */
  const landedRef = useRef(false)

  // A different session is a different conversation: forget everything local about the last one.
  useEffect(() => {
    landedRef.current = false
    setPayload(null)
    setAtTail(true)
    setEcho([])
    setAttached([])
    setReplyTo(null)
  }, [session.id])

  /**
   * Grow the field WITH the draft, up to `TEXTAREA_MAX_HEIGHT`, then let it scroll internally.
   *
   * `rows={1}` plus a CSS `maxHeight` alone never grows: a textarea's own height stays fixed at
   * its `rows` unless something sets it explicitly, so a multi-line draft either scrolled inside a
   * single visible line or was invisible past it — "I can't see my own prompt". Resetting to
   * `'auto'` before reading `scrollHeight` is required: skip it and a field that GREW once can only
   * ever read its own (already tall) scrollHeight back, so deleting text never shrinks it again.
   */
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`
  }, [draft])

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const res = await fetch(`/api/fleet/chat?id=${encodeURIComponent(session.id)}&lang=${lang}`)
        if (!res.ok || !alive) return
        setPayload(await res.json() as ChatPayload)
      } catch { /* transient — keep the last conversation rather than blanking it */ }
    }
    void poll()
    const t = setInterval(poll, CHAT_POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [session.id, lang])

  const working = session.state === 'working'
  const { state: term } = useTerminalStream(working ? session.id : null)

  const turns = useMemo(() => payload?.turns ?? [], [payload])

  // Retire an echo the moment the transcript carries it. Compared on collapsed whitespace, because
  // the harness re-wraps what it stores and an exact match would leave the echo standing forever
  // beside its own committed copy.
  useEffect(() => {
    if (echo.length === 0) return
    const seen = new Set(turns.filter(t => t.role === 'user').map(t => collapse(t.text)))
    setEcho(list => {
      const kept = list.filter(text => !seen.has(collapse(text)))
      return kept.length === list.length ? list : kept
    })
  }, [turns, echo.length])

  const lastAssistant = [...turns].reverse().find(t => t.role === 'assistant' && !t.pending && t.text.trim() !== '')

  const live = useMemo(() => {
    if (!term.frame) return null
    return liveTurnText({
      // The frame carries the emulator's escape sequences; the chat wants the words.
      lines: stripAnsi(term.frame.content).split('\n'),
      ...(lastAssistant ? { lastCommitted: lastAssistant.text } : {}),
      working,
    })
  }, [term.frame, lastAssistant, working])

  const toTail = useCallback((smooth = true) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  /** ONE stable reference for every bubble's reply button — see `ChatBubble`'s memo. */
  const onReplyToTurn = useCallback((t: ChatTurn) => {
    setReplyTo({ role: t.role, text: t.text }); setAtTail(true); toTail()
  }, [toTail])

  /**
   * Land at the END on first paint, then follow the tail only while the reader is already there.
   *
   * `useLayoutEffect` for the landing: with a plain effect the conversation paints at the top and
   * then jumps, which is exactly the flash this exists to avoid. Following is conditional because
   * yanking the view down while somebody reads earlier history is the worst thing a live view does.
   */
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || payload === null) return
    if (!landedRef.current) { el.scrollTop = el.scrollHeight; landedRef.current = true; return }
    if (atTail) el.scrollTop = el.scrollHeight
  }, [turns.length, live, payload, atTail, echo.length])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setAtTail(el.scrollHeight - el.scrollTop - el.clientHeight < TAIL_SLACK)
  }, [])

  const blocked = (session.approvalLines?.length ?? 0) > 0
  const loading = payload === null
  const canPrompt = !loading && session.actionable && !blocked && payload.live !== false
  /** The row's own reopen verb, if it has one. Enabled by the server, never inferred here. */
  const reopen = row?.verbs.find(v => v.action === 'resume')
  const [reopening, setReopening] = useState(false)
  /**
   * Stop the CURRENT turn, without ending the session — the composer's own "esc". Lives here, next
   * to the field, rather than in the panel's header: it is the one thing reached for WHILE something
   * is running, and it does not touch `canPrompt` — typing and sending stay live the whole time, so
   * a reply queued while it works is not blocked on stopping it first. Absent unless the row can
   * take it, since a stop control on an idle session would send Escape into its prompt.
   */
  const stopVerb = row?.verbs.find(v => v.action === 'interrupt')
  const [stopping, setStopping] = useState(false)
  async function stopNow() {
    if (!stopVerb?.enabled || stopping) return
    setStopping(true)
    const out = await act({ id: session.id, action: 'interrupt' })
    setStopping(false)
    if (!out.ok) setNotice(out.message)
  }

  async function reopenNow() {
    if (!reopen?.enabled || reopening) return
    setReopening(true)
    const out = await act({ id: session.id, action: 'resume' })
    setReopening(false)
    setNotice(out.message)
    // The new row arrives on the next fleet poll under a NEW id; the page follows it there. Nothing
    // to do here but say what happened — navigating from inside the composer would be this
    // component deciding where the app goes.
  }

  /**
   * What the session is DOING, from the newest ASSISTANT turn.
   *
   * The newest turn of all is frequently the user's own message, which carries no tools — reading
   * it meant the actions vanished the instant you sent something.
   */
  const newestAssistant = useMemo(
    () => [...turns].reverse().find(t => t.role === 'assistant'),
    [turns],
  )

  /**
   * The working note shows whenever the session is busy, INCLUDING while there is live text.
   *
   * They are different facts: the live bubble is what the assistant is SAYING, the note is what it
   * is DOING. Gating the note on the absence of live text hid the actions for exactly as long as
   * the screen had anything on it, which is most of the time a session is working.
   */
  const showWorking = working && !loading

  async function upload(files: readonly File[]): Promise<void> {
    if (files.length === 0) return
    setUploading(true)
    for (const file of files) {
      const body = new FormData()
      body.append('file', file)
      try {
        const res = await fetch(`/api/fleet/attach?lang=${lang}`, { method: 'POST', body })
        const json = await res.json() as { ok: boolean; path?: string; name?: string; message?: string }
        if (json.ok && json.path && json.name) {
          setAttached(a => [...a, { name: json.name!, path: json.path! }])
        } else {
          setNotice(json.message ?? (pt ? 'O anexo falhou.' : 'The attachment failed.'))
        }
      } catch {
        setNotice(pt ? 'Erro de rede ao enviar o anexo.' : 'Network error uploading the attachment.')
      }
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  function pick(list: FileList | null): void {
    if (!list) return
    const room = attachmentRoom(attached.length)
    const files = Array.from(list).slice(0, room)
    if (files.length < list.length) {
      setNotice(pt
        ? `No máximo ${MAX_ATTACHMENTS} anexos por mensagem.`
        : `At most ${MAX_ATTACHMENTS} attachments per message.`)
    }
    void upload(files)
  }

  /**
   * A paste is three different things and `planPaste` decides which — see that module.
   *
   * The handler only PREVENTS the default when it is doing something else with the clipboard; an
   * ordinary paste falls through to the textarea, which handles the caret and the undo stack better
   * than any manual insert.
   */
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>): void {
    if (!canPrompt) return
    const plan = planPaste({
      files: Array.from(e.clipboardData.files),
      text: e.clipboardData.getData('text/plain'),
      existing: attached.length,
    })
    if (plan.kind === 'text') return
    e.preventDefault()
    if (plan.kind === 'files') { void upload(plan.files); return }
    if (plan.kind === 'textFile') {
      // Too big to type into a pane. Attached as a file instead, and the chip says so.
      void upload([new File([plan.text], plan.name, { type: 'text/plain' })])
      setNotice(pt
        ? 'O texto colado era grande demais para digitar na sessão, então foi anexado como arquivo.'
        : 'The pasted text was too large to type into the session, so it was attached as a file.')
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>): void {
    if (!canPrompt) return
    if (e.dataTransfer.files.length === 0) return
    e.preventDefault()
    pick(e.dataTransfer.files)
  }

  async function send() {
    const text = draft.trim()
    // A message that is ONLY attachments is still a message: the paths are the content.
    if ((text === '' && attached.length === 0) || sending) return
    // Paths first, on their own lines, then what was typed — the assistant reads the files it is
    // pointed at, and burying the paths inside a sentence makes them easy to miss.
    // Quote first, then the paths, then what was typed. The quote is trimmed to a few lines: a
    // reply that repeats forty lines back at the session costs it context for no benefit.
    const quote = replyTo ? quoteLines(replyTo.text) : ''
    const full = [quote, ...attached.map(a => a.path), text].filter(x => x !== '').join('\n')
    setSending(true)
    const out = await act({ id: session.id, action: 'prompt', text: full })
    setSending(false)
    if (out.ok) {
      // Echoed straight away. It is already in the session; the transcript catches up in a poll or
      // two, and this is what makes pressing enter visibly do something.
      setEcho(list => [...list, full])
      setDraft('')
      setAttached([])
      setReplyTo(null)
      setAtTail(true)
      toTail()
      setNotice(null)
      return
    }
    setNotice(out.message)
  }

  if (payload?.unavailable) {
    return (
      <Centered>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-tertiary)' }}>
          {payload.unavailable}
        </p>
        <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.6, color: 'var(--text-tertiary)', opacity: 0.8 }}>
          {pt
            ? 'A visão de terminal continua disponível para esta sessão.'
            : 'The terminal view is still available for this session.'}
        </p>
      </Centered>
    )
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      onDragOver={e => { if (canPrompt && e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDrop={onDrop}
    >
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '20px 20px 8px' }}
      >
        <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {loading ? (
            <Loading pt={pt} />
          ) : turns.length === 0 && live === null && echo.length === 0 ? (
            <Muted text={pt ? 'Esta conversa ainda não tem mensagens.' : 'This conversation has no messages yet.'} />
          ) : null}

          {turns.map((t, i) => (
            <ChatBubble
              key={i}
              turn={t}
              lang={lang}
              harness={session.harness}
              {...(canPrompt ? { onReply: onReplyToTurn } : {})}
            />
          ))}

          {echo.map((text, i) => (
            <ChatBubble key={`echo-${i}`} turn={{ role: 'user', text }} lang={lang} harness={session.harness} />
          ))}

          {/* `live` (the screen read off the terminal frame) is deliberately NOT rendered here any
              more — it used to show as a full-size bubble, and a CLI's own screen carries its own
              chrome (a footer like "auto mode on · esc to interrupt") that `liveTurn.ts`'s line
              filter cannot promise to catch for every harness, so a raw, oversized read-from-the-
              screen block was both the wrong SIZE for a "something is happening" signal and the
              wrong PLACE for whatever chrome slipped through. `live` still drives the follow-the-
              tail effect below (new screen content is a sign to keep scrolling), and `WorkingNote`
              is the one and only "the session is busy" indicator now — small, grey, no raw text. */}

          {/* The quiet line saying the session is busy. AFTER the messages, deliberately not styled
              as one — it is the only place the reasoning and the tool calls surface, and rendering
              those as chat entries buried the sentences actually addressed to the user. */}
          {showWorking && (
            <WorkingNote
              lang={lang}
              {...(newestAssistant?.tools ? { tools: newestAssistant.tools } : {})}
              thinking={Boolean(newestAssistant?.thinking)}
            />
          )}

          {/* The question, at the BOTTOM of the conversation, where the next thing to happen goes.
              It is not in the transcript — a dialog lives on the screen and is never written to the
              JSONL — so it arrives on the fleet row instead. */}
          {blocked && row && <ApprovalCard row={row} lang={lang} act={act} />}
        </div>
      </div>

      {/* PINNED, and on its OWN surface. It never scrolls with the conversation — replying to
          something further up used to mean scroll down, write, scroll back — and it is a shade
          apart from the bubbles, which are `--bg-card` on `--bg-base`: at the same value it read as
          another message rather than as the place you type. */}
      <div style={{
        // `sticky` alongside `flexShrink:0` for the same reason the header above takes both — a
        // scroll-away ancestor anywhere between here and the viewport must not carry this off with
        // it, and sticky is the guarantee that holds even then.
        position: 'sticky', bottom: 0, flexShrink: 0,
        // NO border and NO surface of its own. This used to be a full-width footer bar with a rule
        // across the top, which read as a region of the page rather than as a control — and the
        // thing people recognise as "where I type" is a bounded field, not a strip. The FIELD
        // below carries the border now; this element only positions it.
        padding: '10px 20px 16px',
        background: 'transparent',
      }}>
        {/* Back to the end. Only while the reader has actually scrolled away — a control that is
            always there teaches nothing about where you are. */}
        {!atTail && !loading && (
          <button
            onClick={() => { setAtTail(true); toTail() }}
            aria-label={pt ? 'Ir para a última mensagem' : 'Jump to the latest message'}
            title={pt ? 'Ir para a última mensagem' : 'Jump to the latest message'}
            style={{
              position: 'absolute', top: -46, left: '50%', transform: 'translateX(-50%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 34, height: 34, borderRadius: 17, cursor: 'pointer',
              border: '1px solid var(--border)', background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)', boxShadow: 'var(--ag-shadow-pop)',
            }}
          >
            <ArrowDown size={16} />
          </button>
        )}

        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          {/* NO COMPOSER UNTIL THE CONVERSATION IS THERE. A field offered over a conversation still
              loading invites a message into a session whose state is not yet known — including one
              sitting in a dialog, where the text would go into the dialog's own filter. */}
          {loading ? (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
              {pt ? 'Carregando a conversa…' : 'Loading the conversation…'}
            </p>
          ) : (
            <>
              {blocked && (
                <p style={{ margin: '0 0 8px', fontSize: 11.5, color: 'var(--anthropic-orange)', lineHeight: 1.5 }}>
                  {pt
                    ? 'Esta sessão está esperando resposta a uma pergunta dela. Responda no card acima — o que você digitar aqui iria para o filtro do diálogo.'
                    : 'This session is waiting on an answer to a question of its own. Answer it in the card above — anything typed here would go into the dialog’s own filter.'}
                </p>
              )}

              {/* What is being replied to, above the field, with a way to drop it. */}
              {replyTo && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8,
                  padding: '7px 10px', borderRadius: 9, minWidth: 0,
                  background: 'var(--bg-elevated)',
                  borderLeft: '3px solid var(--anthropic-orange)',
                }}>
                  <span style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--anthropic-orange)' }}>
                      {pt ? 'Respondendo' : 'Replying to'}
                    </span>
                    <span style={{
                      fontSize: 11.5, lineHeight: 1.45, color: 'var(--text-tertiary)',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>
                      {replyTo.text}
                    </span>
                  </span>
                  <button
                    onClick={() => setReplyTo(null)}
                    aria-label={pt ? 'Cancelar resposta' : 'Cancel reply'}
                    style={{
                      display: 'flex', border: 'none', background: 'transparent', padding: 2,
                      color: 'var(--text-tertiary)', cursor: 'pointer', flexShrink: 0,
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              {attached.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {attached.map(a => isImagePath(a.path) ? (
                    // The same square the sent message will wear (see ChatBubble's AttachmentThumb)
                    // — what you see here is what the session's reply will show.
                    <span key={a.path} title={a.name} style={{
                      position: 'relative', display: 'block', width: 48, height: 48,
                      borderRadius: 8, overflow: 'hidden', flexShrink: 0,
                      border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
                    }}>
                      <img
                        src={attachmentUrl(a.path)} alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                      <button
                        onClick={() => setAttached(list => list.filter(x => x.path !== a.path))}
                        aria-label={pt ? `Remover ${a.name}` : `Remove ${a.name}`}
                        style={{
                          position: 'absolute', top: 2, right: 2,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: 16, height: 16, borderRadius: '50%', border: 'none', padding: 0,
                          background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer',
                        }}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ) : (
                    <span key={a.path} title={a.path} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%',
                      padding: '5px 8px', borderRadius: 8, minWidth: 0,
                      background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                      fontSize: 11.5, color: 'var(--text-secondary)',
                    }}>
                      <Paperclip size={11} style={{ flexShrink: 0 }} />
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.name}
                      </span>
                      <button
                        onClick={() => setAttached(list => list.filter(x => x.path !== a.path))}
                        aria-label={pt ? `Remover ${a.name}` : `Remove ${a.name}`}
                        style={{
                          display: 'flex', border: 'none', background: 'transparent', padding: 0,
                          color: 'var(--text-tertiary)', cursor: 'pointer', flexShrink: 0,
                        }}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  {/* Said plainly, because it is NOT what attach means in a chat application: the
                      file is on the machine running the session, and the path is what is sent. */}
                  <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)', alignSelf: 'center' }}>
                    {pt
                      ? 'gravados nesta máquina; o caminho vai na mensagem'
                      : 'stored on this machine; the path goes in the message'}
                  </span>
                </div>
              )}

              {/* A session that is not running cannot be written to, and a disabled field is a dead
                  end. The conversation is still fully readable above; what is offered here is the
                  way BACK INTO it. The verb is the row's own `resume`, which the server enables only
                  when it has a conversation to reopen — where it does not, the sentence says why
                  rather than a button that fails. */}
              {!canPrompt && !blocked && reopen && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  padding: '10px 12px', borderRadius: 12,
                  background: 'var(--bg-base)', border: '1px solid var(--border)',
                }}>
                  <span style={{ flex: 1, minWidth: 160, fontSize: 12, lineHeight: 1.5, color: 'var(--text-tertiary)' }}>
                    {pt
                      ? 'Esta sessão não está rodando, então não dá para escrever nela.'
                      : 'This session is not running, so there is nothing to write to.'}
                  </span>
                  <button
                    onClick={() => void reopenNow()}
                    disabled={!reopen.enabled || reopening}
                    title={reopen.reason}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
                      padding: '9px 14px', borderRadius: 9, border: 'none',
                      background: reopen.enabled ? 'var(--anthropic-orange)' : 'var(--bg-elevated)',
                      color: reopen.enabled ? '#fff' : 'var(--text-tertiary)',
                      cursor: reopen.enabled && !reopening ? 'pointer' : 'default',
                      fontFamily: 'inherit', fontSize: 12.5, fontWeight: 650,
                    }}
                  >
                    {reopening ? <Loader size={14} className="ag-working-spin" /> : <RotateCcw size={14} />}
                    {reopen.label}
                  </button>
                  {/* Why it cannot be reopened, in the row's own words. */}
                  {!reopen.enabled && reopen.reason && (
                    <span style={{ width: '100%', fontSize: 11, lineHeight: 1.45, color: 'var(--text-tertiary)' }}>
                      {reopen.reason}
                    </span>
                  )}
                </div>
              )}

              {/* Loose on the composer's own surface — no second card behind it. It used to sit in
                  its own `--bg-base` box with a border, which read as a field floating inside the
                  field that holds it; dropping both leaves it the same colour as its container. */}
              <div style={{
                display: (!canPrompt && !blocked && reopen) ? 'none' : 'flex',
                // A COLUMN: the text gets the whole width, the controls sit under it.
                //
                // As one row the buttons and the field competed for the same line and the buttons
                // always won — they are `flex-shrink: 0` and the textarea is not. Measured on an
                // iPhone 12: 174px of typing space against ~180px of chrome, so a sentence wrapped
                // at roughly half the width of a box that looked twice as wide. Stacking is what
                // every chat composer does, and it is the only arrangement where the text gets the
                // room the field appears to promise.
                flexDirection: 'column', alignItems: 'stretch', gap: 2,
                // THE FIELD. A rounded, bordered, inset box — the shape a person recognises as
                // somewhere to type. It was previously borderless and flush to the page edges,
                // which is why it read as a footer.
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                padding: '5px 6px 5px 8px',
                opacity: canPrompt ? 1 : 0.55,
                transition: 'border-color 0.15s',
              }}>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  onChange={e => pick(e.target.files)}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={!canPrompt || uploading}
                  aria-label={pt ? 'Anexar arquivo' : 'Attach file'}
                  title={pt ? 'Anexar arquivo' : 'Attach file'}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 34, height: 34, borderRadius: 9, border: 'none', flexShrink: 0,
                    background: 'transparent', color: 'var(--text-tertiary)',
                    cursor: canPrompt && !uploading ? 'pointer' : 'default',
                  }}
                >
                  {uploading ? <Loader size={15} className="ag-working-spin" /> : <Paperclip size={15} />}
                </button>
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onPaste={onPaste}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
                    // The composer's own "esc": stops the CURRENT turn without touching the draft
                    // or the field's own ability to keep taking text — see `stopNow`.
                    if (e.key === 'Escape' && stopVerb?.enabled) { e.preventDefault(); void stopNow() }
                  }}
                  disabled={!canPrompt || sending}
                  rows={1}
                  placeholder={canPrompt
                    ? (pt ? 'Escreva para esta sessão…' : 'Write to this session…')
                    : (pt ? 'Indisponível para esta sessão' : 'Not available for this session')}
                  style={{
                    flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'transparent',
                    color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 13.5,
                    lineHeight: 1.5, maxHeight: TEXTAREA_MAX_HEIGHT, overflowY: 'auto', padding: '6px 6px',
                  }}
                />

                {/* The controls, on their own line under the text. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {/* Working's own stop, right beside the field it does not block. Absent the moment
                    the turn ends — a stop control on an idle session would send Escape into its
                    prompt, which is exactly the row's own gate on `interrupt`. */}
                {working && stopVerb?.enabled && (
                  <button
                    onClick={() => void stopNow()}
                    disabled={stopping}
                    title={stopVerb.label}
                    aria-label={stopVerb.label}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 34, height: 34, borderRadius: 9, flexShrink: 0, cursor: stopping ? 'default' : 'pointer',
                      border: '1px solid color-mix(in srgb, var(--accent-red) 45%, transparent)',
                      background: 'color-mix(in srgb, var(--accent-red) 12%, transparent)',
                      color: 'var(--accent-red)',
                    }}
                  >
                    {stopping ? <Loader size={14} className="ag-working-spin" /> : <Square size={13} fill="currentColor" />}
                  </button>
                )}
                {/* Mic and model live behind ONE button. Four controls plus the field on a
                    390px screen is a row where the buttons win, and these two are the pair a person
                    reaches for occasionally — attach and send are the ones used every turn.
                    A menu, not a second row: another row costs height, which is the thing a phone
                    has least of. */}
                <div ref={moreMenuRef} style={{ position: 'relative', flexShrink: 0 }}>
                  <button
                    onClick={() => setMoreOpen(v => !v)}
                    disabled={!canPrompt || sending}
                    aria-label={pt ? 'Mais opções' : 'More options'}
                    aria-expanded={moreOpen}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 34, height: 34, borderRadius: 9, border: 'none',
                      background: moreOpen ? 'var(--bg-surface)' : 'transparent',
                      color: 'var(--text-tertiary)',
                      cursor: canPrompt ? 'pointer' : 'default',
                    }}
                  >
                    <ChevronUp size={15} style={{ transform: moreOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                  </button>

                  {moreOpen && (
                    <div style={{
                      position: 'absolute', bottom: 40, left: 0, zIndex: 50,
                      minWidth: 210, maxWidth: 260, padding: 4, borderRadius: 10,
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                    }}>
                      {/* DICTATION. Its refusal is a LINE, not a `title`: a phone has no hover, and
                          this is exactly where it is refused most — the Web Speech API needs a
                          secure context, so a dashboard reached over plain HTTP on a LAN never has
                          a microphone. A control that silently does nothing there is one people
                          report as broken, which is what happened. */}
                      <button
                        onClick={() => { if (dictation.state === 'ready') { setMoreOpen(false); toggleDictation() } }}
                        disabled={dictation.state !== 'ready'}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                          minHeight: 40, padding: '6px 8px', borderRadius: 7, border: 'none',
                          background: listening ? 'color-mix(in srgb, var(--accent-red) 12%, transparent)' : 'transparent',
                          color: listening ? 'var(--accent-red)' : 'var(--text-primary)',
                          fontFamily: 'inherit', fontSize: 12.5,
                          cursor: dictation.state === 'ready' ? 'pointer' : 'default',
                          opacity: dictation.state === 'ready' ? 1 : 0.55,
                        }}
                      >
                        <Mic size={14} style={{ flexShrink: 0 }} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                          <span>{listening ? (pt ? 'Parar de ouvir' : 'Stop listening') : (pt ? 'Ditar' : 'Dictate')}</span>
                          {dictation.reason && (
                            <span style={{ fontSize: 10.5, lineHeight: 1.4, color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>
                              {dictation.reason}
                            </span>
                          )}
                        </span>
                      </button>

                      {/* MODEL. Same treatment: where it cannot work, the menu says why instead of
                          offering a control that answers nothing. */}
                      {modelReason ? (
                        <p style={{ margin: 0, padding: '6px 8px', fontSize: 10.5, lineHeight: 1.45, color: 'var(--text-tertiary)' }}>
                          {modelReason}
                        </p>
                      ) : modelSuggestions.length > 0 && (
                        <>
                          <div style={{ height: 1, background: 'var(--border)', margin: '4px 2px' }} />
                          <p style={{
                            margin: '2px 8px 4px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                            letterSpacing: '0.06em', color: 'var(--text-tertiary)',
                          }}>
                            {pt ? 'Modelo' : 'Model'}
                          </p>
                          {modelSuggestions.map(m => (
                            <button
                              key={m}
                              onClick={() => { setMoreOpen(false); void switchModel(m) }}
                              style={{
                                display: 'block', width: '100%', textAlign: 'left',
                                minHeight: 36, padding: '6px 8px', borderRadius: 7, border: 'none',
                                background: 'transparent', color: 'var(--text-primary)',
                                fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer',
                              }}
                            >
                              {m}
                            </button>
                          ))}
                          <p style={{ margin: '2px 8px 4px', fontSize: 10, lineHeight: 1.4, color: 'var(--text-tertiary)' }}>
                            {pt ? 'Envia /model para a sessão.' : 'Sends /model to the session.'}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => void send()}
                  disabled={!canPrompt || sending || (draft.trim() === '' && attached.length === 0)}
                  aria-label={pt ? 'Enviar' : 'Send'}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    // Pushed to the far end of the row — the one control that ACTS sits apart from
                    // the ones that only prepare.
                    marginLeft: 'auto',
                    width: 34, height: 34, borderRadius: 9, border: 'none', flexShrink: 0,
                    background: (draft.trim() === '' && attached.length === 0) || !canPrompt ? 'transparent' : 'var(--anthropic-orange)',
                    color: (draft.trim() === '' && attached.length === 0) || !canPrompt ? 'var(--text-tertiary)' : '#fff',
                    cursor: (draft.trim() === '' && attached.length === 0) || !canPrompt ? 'default' : 'pointer',
                  }}
                >
                  {sending ? <Loader size={15} className="ag-working-spin" /> : <Send size={15} />}
                </button>
                </div>
              </div>
              {notice && (
                <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                  {notice}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * A quoted excerpt, `> `-prefixed, bounded.
 *
 * Bounded because the quote is spent CONTEXT: a reply that echoes forty lines back at the session
 * costs it window for nothing it does not already have. Four lines names the message; an ellipsis
 * says there was more.
 */
function quoteLines(text: string): string {
  const lines = text.trim().split('\n')
  const head = lines.slice(0, 4).map(l => `> ${l}`)
  if (lines.length > 4) head.push('> …')
  return head.join('\n')
}

/** Whitespace-insensitive, because the harness re-wraps what it stores. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function Loading({ pt }: { pt: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      padding: '48px 0', color: 'var(--text-tertiary)', fontSize: 12.5,
    }}>
      <Loader size={16} className="ag-working-spin" />
      {pt ? 'Lendo a conversa…' : 'Reading the conversation…'}
    </div>
  )
}

function Muted({ text }: { text: string }) {
  return <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-tertiary)' }}>{text}</p>
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', minHeight: 260, padding: 32, textAlign: 'center', maxWidth: 460, margin: '0 auto',
    }}>
      {children}
    </div>
  )
}
