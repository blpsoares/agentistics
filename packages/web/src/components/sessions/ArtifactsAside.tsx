/**
 * ArtifactsAside — what this session has written, and the file itself.
 *
 * TWO LAYERS, one panel. The LIST is every file the conversation shows this session touching, newest
 * first; clicking one replaces the list with `ArtifactDoc` and a way back. They are layers rather
 * than a split because the panel is already the narrow column: a list and a document sharing 440px
 * would give the document less room than the conversation it was opened from.
 *
 * IT NEVER CHANGES WHAT IT SHOWS ON ITS OWN. The list updates with each poll of the conversation —
 * that is the "in real time" half — but the OPEN FILE changes only on a click. There is deliberately
 * no effect here that selects an artifact from incoming data: a panel that swaps the document you
 * are reading because the session wrote something else is a panel you cannot read in.
 *
 * THE GALLERY IS THE OTHER DIRECTION. Files, Docs and Live all answer "what did this session DO";
 * the fourth tab answers "what did I SEND it" — the attachments a person put on a message, grouped
 * by the message that carried them. It reads the same `turns` the Live feed does, so it can never
 * claim something the transcript does not show, and its rules live in `gallery.ts`.
 *
 * THREE EMPTY STATES, THREE SENTENCES, and never one shared empty box. "The conversation has not
 * loaded", "this session has written nothing" and "this harness cannot be read this way" are
 * different facts, and only the second is a statement about the session's work. The third reuses
 * `/api/fleet/chat`'s own `unavailable` sentence verbatim rather than inventing a second wording
 * for the same refusal.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FileEdit, FilePlus2, PanelRightClose, Loader, FileText, Activity, Files,
  BookOpen, Terminal, Brain, Send, Eye, Image,
} from 'lucide-react'
import type { Artifact } from '../../lib/sessionArtifacts'
import { agoLabel, isDoc, liveEvents, type LiveEvent, type LiveTurn } from '../../lib/artifactTabs'
import {
  galleryFileCount, galleryGroups, parseGalleryView, type GalleryTurn, type GalleryView,
} from '../../lib/gallery'
import { ArtifactDoc } from './ArtifactDoc'
import { GalleryTab } from './GalleryTab'

type TabId = 'files' | 'docs' | 'live' | 'gallery'

/** Where the view toggle is remembered. One key, read and written in one place. */
const GALLERY_VIEW_KEY = 'agentistics:gallery-view'

export interface ArtifactsAsideProps {
  sessionId: string
  lang: 'pt' | 'en'
  /** Every file this session touched, newest first. */
  artifacts: readonly Artifact[]
  /** The conversation has not answered yet — distinct from having answered with nothing. */
  loading: boolean
  /**
   * The harness's own refusal, when the conversation cannot be read at all. Already localized by
   * the server; shown verbatim so this panel and the chat give one answer.
   */
  unavailable?: string
  onClose: () => void
  /**
   * The session wrote through commands whose paths cannot be read off the command line.
   *
   * Reported rather than swallowed: on a session that had produced eighty files this panel said
   * "nothing written in this session yet", which is a confident wrong answer. "I cannot list these"
   * and "there are none" are different facts and get different sentences.
   */
  unlistedWrites?: boolean
  /**
   * The conversation's turns, for the LIVE tab.
   *
   * The feed is derived from the same turns the chat renders, so it can never claim something the
   * transcript does not show — which is the only guarantee that matters for a view whose whole
   * promise is "this is what is happening".
   */
  turns?: readonly LiveTurn[]
}

/** `new` and `edited` read at a glance from the glyph; the word is beside it for everyone else. */
function KindIcon({ kind }: { kind: Artifact['kind'] }) {
  return kind === 'new'
    ? <FilePlus2 size={13} style={{ color: 'var(--accent-green, #22c55e)', flexShrink: 0 }} />
    : <FileEdit size={13} style={{ color: 'var(--anthropic-orange)', flexShrink: 0 }} />
}

export function ArtifactsAside({
  sessionId, lang, artifacts, loading, unavailable, unlistedWrites, turns, onClose,
}: ArtifactsAsideProps) {
  const pt = lang === 'pt'
  const [open, setOpen] = useState<Artifact | null>(null)
  const [tab, setTab] = useState<TabId>('files')

  /** DOCS is a SUBSET of files, never a second list — a document cannot be in one and missing from
   *  the other. `isDoc` decides it by extension, which is what can be known without opening it. */
  const docs = useMemo(() => artifacts.filter(a => isDoc(a.path)), [artifacts])
  /**
   * CHRONOLOGICAL, oldest first, and the view follows the tail.
   *
   * It was newest-first, and the ordering was unreadable because nothing on the row said which end
   * was which — reported as exactly that. A feed of what a session is DOING reads like a terminal
   * or a chat: the newest thing is at the BOTTOM, you arrive at it, and it stays in view while more
   * arrives. Each row carries how long ago it happened, so the direction is stated rather than
   * inferred from a scroll position.
   */
  const feed = useMemo(() => liveEvents(turns ?? []), [turns])
  /** What the PERSON sent, grouped by message. See `gallery.ts` — nothing here re-derives it. */
  const gallery = useMemo(() => galleryGroups((turns ?? []) as readonly GalleryTurn[]), [turns])
  const galleryFiles = useMemo(() => galleryFileCount(gallery), [gallery])
  /** LIST or GRID, remembered. A private window that refuses storage simply keeps the default. */
  const [galleryView, setGalleryView] = useState<GalleryView>(() => {
    try { return parseGalleryView(localStorage.getItem(GALLERY_VIEW_KEY)) } catch { return 'grid' }
  })
  const chooseGalleryView = (v: GalleryView) => {
    setGalleryView(v)
    try { localStorage.setItem(GALLERY_VIEW_KEY, v) } catch { /* private mode */ }
  }
  const feedRef = useRef<HTMLDivElement>(null)
  /** A clock, so "3m ago" ages while the panel is open rather than freezing at its first render. */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (tab !== 'live') return
    const el = feedRef.current
    if (!el) return
    // Follow the tail only while the reader IS at the tail. Yanking the view down while somebody
    // scrolled up to read something is the worst thing a live view does — the same rule the chat
    // keeps.
    const atTail = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (atTail || el.scrollTop === 0) el.scrollTop = el.scrollHeight
  }, [feed.length, tab])

  const live = artifacts.filter(a => a.live)
  const past = artifacts.filter(a => !a.live)
  const created = artifacts.filter(a => a.kind === 'new').length

  const header = (
    <header style={{
      display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      padding: '10px 12px', borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.3, color: 'var(--text-primary)' }}>
        {pt ? 'Artefatos' : 'Artifacts'}
      </span>
      {artifacts.length > 0 && (
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {artifacts.length} {pt ? (artifacts.length === 1 ? 'arquivo' : 'arquivos') : (artifacts.length === 1 ? 'file' : 'files')}
          {created > 0 && ` · ${created} ${pt ? (created === 1 ? 'novo' : 'novos') : 'new'}`}
        </span>
      )}
      <button
        onClick={onClose}
        aria-label={pt ? 'Fechar artefatos' : 'Close artifacts'}
        title={pt ? 'Fechar artefatos' : 'Close artifacts'}
        style={{
          marginLeft: 'auto', display: 'flex', width: 26, height: 26, borderRadius: 7,
          alignItems: 'center', justifyContent: 'center', border: 'none',
          background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer',
        }}
      >
        <PanelRightClose size={15} />
      </button>
    </header>
  )

  /** The three tabs. A count rides each one, so the panel says what is behind a tab unopened. */
  const tabs: { id: TabId; label: string; icon: React.ReactNode; count: number }[] = [
    { id: 'files', label: pt ? 'Arquivos' : 'Files', icon: <Files size={12} />, count: artifacts.length },
    { id: 'docs', label: pt ? 'Docs' : 'Docs', icon: <BookOpen size={12} />, count: docs.length },
    { id: 'live', label: 'Live', icon: <Activity size={12} />, count: feed.length },
    {
      id: 'gallery',
      label: pt ? 'Galeria' : 'Gallery',
      icon: <Image size={12} />,
      count: galleryFiles,
    },
  ]

  const tabBar = (
    <div role="tablist" style={{
      display: 'flex', gap: 2, padding: '6px 8px', flexShrink: 0,
      borderBottom: '1px solid var(--border)',
    }}>
      {tabs.map(t => {
        const on = tab === t.id
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => setTab(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px',
              borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 11.5, fontWeight: on ? 700 : 500,
              background: on ? 'var(--bg-elevated)' : 'transparent',
              color: on ? 'var(--text-primary)' : 'var(--text-tertiary)',
            }}
          >
            {t.icon}
            {t.label}
            {t.count > 0 && (
              <span style={{ fontSize: 10, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{t.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )

  const liveBody = (): React.ReactNode => {
    if (feed.length === 0) {
      return <Note text={pt
        ? 'Nada aconteceu nesta conversa ainda.'
        : 'Nothing has happened in this conversation yet.'} />
    }
    return (
      <div ref={feedRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 6px 10px' }}>
        {feed.map((e, i) => (
          <EventRow
            key={i} e={e} pt={pt} now={now}
            // A WROTE row is a link to the file it names. Only when that file is actually in the
            // Files list: the feed shows every write the transcript recorded, while Files shows the
            // ones still readable on disk, and offering to open a deleted file would be a row whose
            // only outcome is a refusal.
            {...(openFromFeed(e.text) ? { onOpen: () => openFromFeed(e.text)!() } : {})}
          />
        ))}
      </div>
    )
  }

  /**
   * Clicking a written path in the feed takes you to the file — the Files tab, with it open.
   *
   * Returns null when the path is not in the list, and the row is then plain text rather than a
   * dead link: the feed records every write the transcript saw, while Files holds the ones still
   * readable, and a link whose only outcome is a refusal is the control-that-reads-as-broken this
   * codebase argues against everywhere else.
   */
  const openFromFeed = (path: string): (() => void) | null => {
    const hit = artifacts.find(a => a.path === path)
    if (!hit) return null
    return () => { setTab('files'); setOpen(hit) }
  }

  const fileList = (list: readonly Artifact[], emptyText: string): React.ReactNode => {
    if (list.length === 0) return <Note text={emptyText} />
    const liveOnes = list.filter(a => a.live)
    const pastOnes = list.filter(a => !a.live)
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 6px 10px' }}>
        {liveOnes.length > 0 && (
          <Band label={pt ? 'agora' : 'now'}>
            {liveOnes.map(a => <Row key={a.path} a={a} pt={pt} onOpen={() => setOpen(a)} />)}
          </Band>
        )}
        {pastOnes.length > 0 && (
          <Band label={liveOnes.length > 0 ? (pt ? 'antes' : 'earlier') : undefined}>
            {pastOnes.map(a => <Row key={a.path} a={a} pt={pt} onOpen={() => setOpen(a)} />)}
          </Band>
        )}
        {unlistedWrites && (
          <p style={{ margin: '6px 8px 0', fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-tertiary)' }}>
            {pt
              ? 'A sessão também escreveu por comandos cujos caminhos não dá para ler; esses arquivos não estão nesta lista.'
              : 'The session also wrote through commands whose paths cannot be read; those files are not in this list.'}
          </p>
        )}
      </div>
    )
  }

  /**
   * The gallery, or the reason it is not showing one.
   *
   * "The conversation has not loaded" and "nothing was ever sent" are different facts and get
   * different sentences — the same rule the other three tabs follow. The empty one is `GalleryTab`'s
   * own, because it is a statement about the gallery rather than about this panel.
   */
  const galleryBody = (): React.ReactNode => {
    if (loading && (turns?.length ?? 0) === 0) {
      return (
        <Note icon={<Loader size={13} className="ag-working-spin" />}
          text={pt ? 'Lendo a conversa…' : 'Reading the conversation…'} />
      )
    }
    return (
      <GalleryTab
        groups={gallery}
        lang={lang}
        view={galleryView}
        onViewChange={chooseGalleryView}
      />
    )
  }

  const body = (): React.ReactNode => {
    // The refusal outranks everything: there is no list to be empty when the conversation cannot be
    // read at all.
    if (unavailable) return <Note text={unavailable} />
    if (loading && artifacts.length === 0) {
      return (
        <Note icon={<Loader size={13} className="ag-working-spin" />}
          text={pt ? 'Lendo a conversa…' : 'Reading the conversation…'} />
      )
    }
    if (artifacts.length === 0) {
      // The two empty answers are NOT the same. One is a fact about the session's work; the other
      // is a limit of this reader, and saying the first when the second is true is the confident
      // wrong answer this panel was reported for.
      return unlistedWrites ? (
        <Note text={pt
          ? 'Esta sessão escreveu por comandos de shell cujos caminhos não dá para ler da linha de comando — um interpretador alimentado por heredoc, por exemplo. Os arquivos existem; esta lista não consegue nomeá-los.'
          : 'This session wrote through shell commands whose paths cannot be read from the command line — an interpreter fed a heredoc, for instance. The files exist; this list cannot name them.'} />
      ) : (
        <Note text={pt
          ? 'Nada escrito ainda nesta sessão. Arquivos aparecem aqui assim que a sessão escreve ou edita um.'
          : 'Nothing written in this session yet. Files appear here as soon as the session writes or edits one.'} />
      )
    }
    return tab === 'docs'
      ? fileList(docs, pt
          ? 'Nenhum documento escrito nesta sessão DENTRO da pasta dela. Arquivos .md, .txt e afins aparecem aqui — mas só os que ficam na pasta da sessão: um arquivo escrito fora dela não pode ser lido daqui, e por isso não é listado.'
          : 'No document written in this session INSIDE its folder. Files like .md and .txt appear here — but only those inside the session\'s folder: a file written outside it cannot be read from here, so it is not listed.')
      : fileList(artifacts, pt
          ? 'Nada escrito ainda nesta sessão. Arquivos aparecem aqui assim que a sessão escreve ou edita um.'
          : 'Nothing written in this session yet. Files appear here as soon as the session writes or edits one.')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0 }}>
      {open ? (
        <ArtifactDoc sessionId={sessionId} artifact={open} lang={lang} onBack={() => setOpen(null)} />
      ) : (
        <>
          {header}
          {/* The tab bar is BELOW the header, so the close button keeps one place whatever tab is
              open — a control that moves with the content is one people stop finding. */}
          {!unavailable && tabBar}
          {/* The REFUSAL outranks every tab: there is no list, feed or gallery to be empty when
              the conversation cannot be read at all, and `body()` is where that one sentence
              lives. */}
          {unavailable ? body()
            : tab === 'live' ? liveBody()
            : tab === 'gallery' ? galleryBody()
            : body()}
        </>
      )}
    </div>
  )
}

function Band({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      {label && (
        <p style={{
          margin: '4px 6px 4px', fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5,
          textTransform: 'uppercase', color: 'var(--text-tertiary)',
        }}>{label}</p>
      )}
      {children}
    </div>
  )
}

function Row({ a, pt, onOpen }: { a: Artifact; pt: boolean; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      title={a.path}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%', textAlign: 'left',
        padding: '7px 8px', borderRadius: 8, border: 'none', background: 'transparent',
        cursor: 'pointer', fontFamily: 'inherit', minWidth: 0,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ paddingTop: 2 }}><KindIcon kind={a.kind} /></span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{
          display: 'block', fontSize: 12.5, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{a.name}</span>
        <span style={{
          display: 'block', fontSize: 10.5, color: 'var(--text-tertiary)', direction: 'rtl',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{a.dir}</span>
        {/* The live row says what it is DOING; the others say how much they were touched, and only
            when it was more than once — "1 edit" is noise on every row that has one. */}
        {a.live ? (
          <span style={{ fontSize: 10.5, color: 'var(--anthropic-orange)' }}>
            {pt ? 'escrevendo…' : 'writing…'}
          </span>
        ) : a.touches > 1 ? (
          <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>
            {a.touches} {pt ? 'edições' : 'edits'}
          </span>
        ) : null}
      </span>
    </button>
  )
}

/**
 * One line of the live feed.
 *
 * The KIND leads, as a glyph and a colour, because "read a file" and "ran a command" are different
 * events and a grey list of strings is a log rather than a view. The text is monospaced for the
 * three kinds that carry a path or a command — those are read character by character — and left in
 * the reading face for the two that carry prose.
 */
function EventRow({ e, pt, now, onOpen }: { e: LiveEvent; pt: boolean; now: number; onOpen?: () => void }) {
  const meta: Record<LiveEvent['kind'], { icon: React.ReactNode; color: string; label: string }> = {
    wrote: { icon: <FileEdit size={11} />, color: 'var(--anthropic-orange)', label: pt ? 'escreveu' : 'wrote' },
    read: { icon: <Eye size={11} />, color: 'var(--text-tertiary)', label: pt ? 'leu' : 'read' },
    ran: { icon: <Terminal size={11} />, color: 'var(--text-secondary)', label: pt ? 'rodou' : 'ran' },
    thought: { icon: <Brain size={11} />, color: '#a78bfa', label: pt ? 'pensou' : 'thought' },
    delegated: { icon: <Send size={11} />, color: '#22c55e', label: pt ? 'delegou' : 'delegated' },
    said: { icon: <FileText size={11} />, color: 'var(--text-secondary)', label: pt ? 'disse' : 'said' },
  }
  const m = meta[e.kind]
  const mono = e.kind === 'wrote' || e.kind === 'read' || e.kind === 'ran'
  const Tag = onOpen ? 'button' : 'div'
  return (
    <Tag
      {...(onOpen ? { onClick: onOpen, title: e.text } : {})}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 7, padding: '5px 8px',
        opacity: e.live ? 1 : 0.92,
        width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
        borderRadius: 7, fontFamily: 'inherit',
        cursor: onOpen ? 'pointer' : 'default',
      }}
      {...(onOpen ? {
        onMouseEnter: (ev: React.MouseEvent<HTMLElement>) => { ev.currentTarget.style.background = 'var(--bg-elevated)' },
        onMouseLeave: (ev: React.MouseEvent<HTMLElement>) => { ev.currentTarget.style.background = 'transparent' },
      } : {})}
    >
      <span style={{ color: m.color, paddingTop: 2, flexShrink: 0 }}>{m.icon}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{
          fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
          color: m.color, marginRight: 6,
        }}>{m.label}</span>
        <span style={{
          fontSize: 11.5, color: 'var(--text-secondary)', wordBreak: 'break-word',
          fontFamily: mono ? 'var(--font-mono, ui-monospace, monospace)' : 'inherit',
        }}>{e.text}</span>
      </span>
      {/* HOW LONG AGO, right-aligned, so the column reads as a timeline down the edge. Absent when
          the transcript recorded no time — nothing here is invented. */}
      {agoLabel(e.at, now, pt) !== '' && (
        <span style={{
          flexShrink: 0, fontSize: 10, color: 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums', paddingTop: 2,
        }}>{agoLabel(e.at, now, pt)}</span>
      )}
    </Tag>
  )
}

function Note({ text, icon }: { text: string; icon?: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px 18px',
    }}>
      <p style={{
        margin: 0, fontSize: 12, lineHeight: 1.6, textAlign: 'center',
        color: 'var(--text-tertiary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      }}>
        {icon}
        {text}
      </p>
    </div>
  )
}
