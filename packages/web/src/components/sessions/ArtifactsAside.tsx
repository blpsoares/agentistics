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
  BookOpen, Terminal, Brain, Send, Eye, Image, Sparkles, ChevronLeft, ChevronDown, ChevronRight,
  ExternalLink, Bot, Plug, Plus, Trash2,
} from 'lucide-react'
import type { Artifact } from '../../lib/sessionArtifacts'
import {
  countSkills, groupSkills, shortName, skillInvocation, type SkillEntry,
} from '../../lib/skillGroups'
import { requestDraft } from '../../lib/composerStore'
import { splitFrontmatter } from '../../lib/skillGroups'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useIsMobile } from '../../hooks/useIsMobile'
import { agoLabel, isDoc, liveEvents, writeStatus, type LiveEvent, type LiveTurn, type WriteStatus } from '../../lib/artifactTabs'
import {
  stepNotice, stepOpenable, stepPollMs, stepUrl,
  type StepPayload, type StepState,
} from '../../lib/stepDetail'
import {
  runningCount, subagentCount, subagentStatusText, subagentsPollMs, subagentsStateOf,
  unmeasuredText, unpricedText,
  type SubagentRow, type SubagentsPayload, type SubagentsState,
} from '../../lib/subagents'
import {
  cannotWriteText, offerableScopes, runText, runningMcpCount, scopeText,
  type McpEntry, type McpListPayload, type McpScope,
} from '../../lib/mcpPanel'
import { fmt, fmtCost } from '@agentistics/core'
import {
  galleryFileCount, galleryGroups, parseGalleryScope, parseGalleryView, producedGroups,
  type GalleryScope, type GalleryTurn, type GalleryView,
} from '../../lib/gallery'
import { ArtifactDoc } from './ArtifactDoc'
import { GalleryTab } from './GalleryTab'

type TabId = 'files' | 'docs' | 'live' | 'gallery' | 'skills' | 'agents' | 'mcps'

/** Where the view toggle is remembered. One key, read and written in one place. */
const GALLERY_VIEW_KEY = 'agentistics:gallery-view'
const GALLERY_SCOPE_KEY = 'agentistics:gallery-scope'
const SKILL_FORMAT_KEY = 'agentistics:skill-format'

export interface ArtifactsAsideProps {
  /**
   * The session's own directory.
   *
   * Only the MCP tab uses it, and it uses it for a decision rather than a label: the `local` and
   * `project` scopes are resolved against a directory, so without one they are ABSENT from the
   * picker rather than present and silently widened to "this machine".
   */
  cwd?: string
  /**
   * A tab an OPENER asked for, with the stamp that makes it a request rather than a setting.
   *
   * The reader's own choice is what normally decides the tab; this exists because the edge marker's
   * whole sentence is "the harness is running something", and pressing it to land on the file list
   * answers a question nobody asked. See `artifactsStore.ts`.
   */
  tabRequest?: { tab: string; at: number } | null
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
  /**
   * What the SERVER knows about each listed path: how big it is, and whether it belongs to the
   * project or is scratch under the system temp directory.
   *
   * The browser cannot answer either — it has the conversation, not the disk — and a size or a
   * scope guessed from a path would be exactly the confident wrong answer this panel keeps being
   * asked not to give.
   */
  facts?: ReadonlyMap<string, { bytes: number; scope: 'project' | 'temp' }>
}

/** `new` and `edited` read at a glance from the glyph; the word is beside it for everyone else. */
function KindIcon({ kind }: { kind: Artifact['kind'] }) {
  return kind === 'new'
    ? <FilePlus2 size={13} style={{ color: 'var(--accent-green, #22c55e)', flexShrink: 0 }} />
    : <FileEdit size={13} style={{ color: 'var(--anthropic-orange)', flexShrink: 0 }} />
}

export function ArtifactsAside({
  sessionId, cwd, lang, artifacts, loading, unavailable, unlistedWrites, turns, facts, onClose,
  tabRequest,
}: ArtifactsAsideProps) {
  const pt = lang === 'pt'
  const isMobile = useIsMobile()
  const [open, setOpen] = useState<Artifact | null>(null)
  const [tab, setTab] = useState<TabId>('files')
  /** The SUBAGENTS tab's own state — declared here because the tab BAR reads its count. */
  const [agentsState, setAgentsState] = useState<SubagentsState | null>(null)
  const [openAgent, setOpenAgent] = useState<SubagentRow | null>(null)
  /** The MCP tab's own state — declared here because the tab BAR reads its count. */
  const [mcp, setMcp] = useState<McpListPayload | null>(null)
  const [mcpError, setMcpError] = useState<string | null>(null)
  const [mcpNonce, setMcpNonce] = useState(0)

  /**
   * Honour a requested tab, once per request.
   *
   * Keyed on the STAMP and not on the value: the reader must stay free to move afterwards, which a
   * `[tabRequest.tab]` dependency would take away — they click Files, the prop still reads `live`,
   * and nothing changes so nothing re-runs, but the next unrelated render restores it.
   * An unknown tab is IGNORED rather than defaulted: whoever wrote it meant something this panel
   * does not have, and dropping them on Files would look like the request was honoured.
   */
  const askedAt = tabRequest?.at
  useEffect(() => {
    const t = tabRequest?.tab
    if (t === 'files' || t === 'docs' || t === 'live' || t === 'gallery' || t === 'skills' || t === 'agents' || t === 'mcps') setTab(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askedAt])

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
  /**
   * The gallery: what the PERSON sent, grouped by message, PLUS what the SESSION produced.
   *
   * Two sources, one list, because a reader looking for a picture is not asking who made it. The
   * produced block goes LAST: the sent groups carry the messages they came with and read as the
   * conversation, while the produced one is a single block with no message of its own.
   */
  const gallery = useMemo(() => [
    ...galleryGroups((turns ?? []) as readonly GalleryTurn[]),
    ...producedGroups(artifacts),
  ], [turns, artifacts])
  const galleryFiles = useMemo(() => galleryFileCount(gallery), [gallery])
  /** LIST or GRID, remembered. A private window that refuses storage simply keeps the default. */
  const [galleryView, setGalleryView] = useState<GalleryView>(() => {
    try { return parseGalleryView(localStorage.getItem(GALLERY_VIEW_KEY)) } catch { return 'grid' }
  })
  /** WHOSE files — remembered like the view is. A private window that refuses storage keeps `all`. */
  const [galleryScope, setGalleryScope] = useState<GalleryScope>(() => {
    try { return parseGalleryScope(localStorage.getItem(GALLERY_SCOPE_KEY)) } catch { return 'all' }
  })
  const chooseGalleryScope = (v: GalleryScope) => {
    setGalleryScope(v)
    try { localStorage.setItem(GALLERY_SCOPE_KEY, v) } catch { /* private mode */ }
  }
  const chooseGalleryView = (v: GalleryView) => {
    setGalleryView(v)
    try { localStorage.setItem(GALLERY_VIEW_KEY, v) } catch { /* private mode */ }
  }
  /**
   * The skills this session can invoke, read ONCE and only when the tab is opened.
   *
   * The composer fetches the same list for its `/` picker; this is a second reader of one route,
   * not a second source. Deliberately not lifted into a shared store: the two are opened at
   * different moments and a store would fetch for a reader that never asked.
   *
   * `null` is "not read yet" and `[]` is "none", which are different sentences on screen — the same
   * distinction the rest of this panel keeps.
   */
  const [skills, setSkills] = useState<SkillEntry[] | null>(null)
  const [skillsNote, setSkillsNote] = useState<string | null>(null)
  const [skillQuery, setSkillQuery] = useState('')
  /** The skill being READ, and its file. `null` is the list; a name is the detail view. */
  const [openSkill, setOpenSkill] = useState<string | null>(null)
  /** How the skill's file is shown. Remembered, because it is a preference and not a per-skill one. */
  const [skillFormat, setSkillFormat] = useState<'md' | 'text'>(() => {
    try { return localStorage.getItem(SKILL_FORMAT_KEY) === 'text' ? 'text' : 'md' } catch { return 'md' }
  })
  const chooseSkillFormat = (v: 'md' | 'text') => {
    setSkillFormat(v)
    try { localStorage.setItem(SKILL_FORMAT_KEY, v) } catch { /* private mode */ }
  }
  const [skillBody, setSkillBody] = useState<
    { ok: true; text: string; truncated: boolean } | { ok: false; message: string } | null
  >(null)
  useEffect(() => {
    if (openSkill === null) { setSkillBody(null); return }
    let alive = true
    setSkillBody(null)
    fetch(`/api/fleet/skill?id=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(openSkill)}&lang=${pt ? 'pt' : 'en'}`)
      .then(r => r.json())
      .then((d: { ok?: boolean; text?: string; truncated?: boolean; message?: string }) => {
        if (!alive) return
        setSkillBody(d?.ok
          ? { ok: true, text: d.text ?? '', truncated: d.truncated === true }
          : { ok: false, message: d?.message ?? (pt ? 'Não foi possível ler.' : 'Could not read it.') })
      })
      .catch(() => {
        if (alive) setSkillBody({ ok: false, message: pt ? 'Não foi possível ler.' : 'Could not read it.' })
      })
    return () => { alive = false }
  }, [openSkill, sessionId, pt])
  const skillGroups = useMemo(
    () => groupSkills(skills ?? [], skillQuery, pt ? 'pt' : 'en'),
    [skills, skillQuery, pt],
  )
  useEffect(() => {
    if (tab !== 'skills' || skills !== null) return
    let alive = true
    fetch(`/api/fleet/skills?id=${encodeURIComponent(sessionId)}&lang=${pt ? 'pt' : 'en'}`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: { skills?: SkillEntry[]; reason?: string } | null) => {
        if (!alive) return
        setSkills(d?.skills ?? [])
        setSkillsNote(d?.reason ?? null)
      })
      .catch(() => { if (alive) setSkills([]) })
    return () => { alive = false }
  }, [tab, skills, sessionId, pt])

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
        {pt ? 'Conteúdo' : 'Contents'}
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
        title={pt ? 'Fechar o painel' : 'Close the panel'}
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
  const tabs: { id: TabId; label: string; icon: React.ReactNode; count: number | null }[] = [
    { id: 'files', label: pt ? 'Arquivos' : 'Files', icon: <Files size={12} />, count: artifacts.length },
    { id: 'docs', label: pt ? 'Docs' : 'Docs', icon: <BookOpen size={12} />, count: docs.length },
    { id: 'live', label: 'Live', icon: <Activity size={12} />, count: feed.length },
    {
      id: 'gallery',
      label: pt ? 'Galeria' : 'Gallery',
      icon: <Image size={12} />,
      count: galleryFiles,
    },
    // The count is 0 until the tab is opened, and that is honest rather than lazy: the panel has
    // not asked the host yet, and a number it has not measured is the thing this codebase refuses
    // to print everywhere else.
    { id: 'skills', label: 'Skills', icon: <Sparkles size={12} />, count: skills?.length ?? 0 },
    // `null`, not 0, wherever a count would be a claim: only Claude Code records subagents at all,
    // and until the tab is opened this panel has not asked. See `subagentCount`.
    {
      id: 'agents',
      label: pt ? 'Subagentes' : 'Subagents',
      icon: <Bot size={12} />,
      count: subagentCount(agentsState),
    },
    { id: 'mcps', label: 'MCPs', icon: <Plug size={12} />, count: mcp?.servers.length ?? null },
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
            {t.count !== null && t.count > 0 && (
              <span style={{ fontSize: 10, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{t.count}</span>
            )}
            {/* One dot per tab that has something RUNNING behind it — the reason to look now. */}
            {t.id === 'mcps' && runningMcpCount(mcp?.servers ?? null) > 0 && (
              <span
                aria-hidden
                style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }}
              />
            )}
            {t.id === 'agents' && runningCount(agentsState) > 0 && (
              <span
                aria-hidden
                style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }}
              />
            )}
          </button>
        )
      })}
    </div>
  )

  /**
   * THE SUBAGENTS TAB — every subagent this conversation ran, running or finished.
   *
   * Fetched when the tab is opened and re-fetched only while one is still RUNNING: a finished
   * agent's numbers cannot change, and the list costs a full read of the parent transcript (that is
   * where the outcomes are recorded). All of those rules are in `lib/subagents.ts`.
   */
  useEffect(() => {
    // The tab is what asks. Nothing is fetched for a panel nobody opened onto it.
    if (tab !== 'agents') return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let first = true
    const read = async () => {
      if (first) setAgentsState({ phase: 'loading' })
      try {
        const res = await fetch(`/api/fleet/subagents?id=${encodeURIComponent(sessionId)}&lang=${pt ? 'pt' : 'en'}`)
        if (!alive) return
        if (!res.ok) {
          setAgentsState({ phase: 'failed', message: pt ? 'Não foi possível ler os subagentes.' : 'The subagents could not be read.' })
          return
        }
        const next = subagentsStateOf(await res.json() as SubagentsPayload)
        if (!alive) return
        setAgentsState(next)
        const wait = subagentsPollMs(next)
        if (wait !== null) timer = setTimeout(read, wait)
      } catch {
        if (alive) setAgentsState({ phase: 'failed', message: pt ? 'Não foi possível ler os subagentes.' : 'The subagents could not be read.' })
      } finally { first = false }
    }
    void read()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [tab, sessionId, pt])

  /** A different session is a different fleet of subagents; nothing carries over. */
  useEffect(() => { setAgentsState(null); setOpenAgent(null) }, [sessionId])

  const agentsBody = (): React.ReactNode => {
    // One open agent replaces the list, exactly as an open FILE does — 440px cannot hold a list and
    // a conversation side by side.
    if (openAgent) {
      return (
        <SubagentActivity
          sessionId={sessionId} row={openAgent} pt={pt} now={now}
          onBack={() => setOpenAgent(null)}
        />
      )
    }
    const st = agentsState
    if (st === null || st.phase === 'loading') {
      return <Note icon={<Loader size={16} />} text={pt ? 'Lendo os subagentes…' : 'Reading the subagents…'} />
    }
    // FOUR SENTENCES, and never one shared empty box: the harness cannot report them, the read
    // failed, this conversation ran none, or here they are.
    if (st.phase === 'unsupported') return <Note icon={<Bot size={16} />} text={st.message} />
    if (st.phase === 'failed') return <Note text={st.message} />
    if (st.rows.length === 0) {
      return <Note icon={<Bot size={16} />} text={pt
        ? 'Esta conversa não delegou nada a um subagente.'
        : 'This conversation has not delegated anything to a subagent.'} />
    }
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 6px 10px' }}>
        {st.rows.map(r => (
          <SubagentCard key={r.agentId} row={r} pt={pt} now={now} onOpen={() => setOpenAgent(r)} />
        ))}
      </div>
    )
  }

  /**
   * THE MCP TAB — what this machine has configured, what is actually running, and the two writes.
   *
   * Re-read on `mcpNonce`, which a write bumps: the list after an install must be the list the
   * harness's own command produced, not the one this panel guessed it would produce.
   */
  useEffect(() => {
    if (tab !== 'mcps') return
    let alive = true
    const read = async () => {
      try {
        const q = cwd ? `?projectPath=${encodeURIComponent(cwd)}` : ''
        const res = await fetch(`/api/mcp/servers${q}`)
        if (!alive) return
        if (!res.ok) {
          // 403 is the exposure profile refusing host power, and it is a different fact from a
          // machine with no MCPs — the same rule the live-sessions panel keeps.
          setMcpError(res.status === 403
            ? (pt ? 'Este perfil de exposição não permite ler nem mudar a configuração de MCP desta máquina.'
              : 'This exposure profile does not allow reading or changing this machine’s MCP configuration.')
            : (pt ? 'Não foi possível ler os MCPs.' : 'The MCP servers could not be read.'))
          return
        }
        setMcpError(null)
        setMcp(await res.json() as McpListPayload)
      } catch {
        if (alive) setMcpError(pt ? 'Não foi possível ler os MCPs.' : 'The MCP servers could not be read.')
      }
    }
    void read()
    return () => { alive = false }
  }, [tab, cwd, pt, mcpNonce])

  const mcpBody = (): React.ReactNode => (
    <McpTab
      lang={lang}
      list={mcp}
      error={mcpError}
      {...(cwd ? { cwd } : {})}
      onChanged={() => setMcpNonce(n => n + 1)}
    />
  )

  const liveBody = (): React.ReactNode => {
    if (feed.length === 0) {
      return <Note text={pt
        ? 'Nada aconteceu nesta conversa ainda.'
        : 'Nothing has happened in this conversation yet.'} />
    }
    return (
      <div ref={feedRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 6px 10px' }}>
        {/* THE DIRECTION, said rather than inferred. A reader arriving at a scrolled list cannot
            tell which end is the newest, and asked exactly that. It sits at the TOP because that is
            the end somebody scrolls away from — the bottom explains itself by being where the view
            lands. */}
        <p style={{
          margin: '0 8px 6px', fontSize: 10, lineHeight: 1.5, color: 'var(--text-tertiary)',
          borderBottom: '1px solid var(--border-subtle)', paddingBottom: 6,
        }}>
          {pt
            ? 'Mais antigo em cima · o mais recente fica embaixo, e a view acompanha.'
            : 'Oldest at the top · the newest stays at the bottom, and the view follows it.'}
        </p>
        {feed.map((e, i) => (
          <EventRow
            key={i} e={e} pt={pt} now={now} sessionId={sessionId}
            // A WROTE row is a link to the file it names. Only when that file is actually in the
            // Files list: the feed shows every write the transcript recorded, while Files shows the
            // ones still readable on disk, and offering to open a deleted file would be a row whose
            // only outcome is a refusal.
            {...(openFromFeed(e.text) ? { onOpen: () => openFromFeed(e.text)!() } : {})}
            {...(e.kind === 'wrote'
              ? { status: writeStatus(e.text, new Set(artifacts.map(a => a.path))) }
              : {})}
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
            {liveOnes.map(a => <Row key={a.path} a={a} pt={pt} fact={facts?.get(a.path)} onOpen={() => setOpen(a)} />)}
          </Band>
        )}
        {pastOnes.length > 0 && (
          <Band label={liveOnes.length > 0 ? (pt ? 'antes' : 'earlier') : undefined}>
            {pastOnes.map(a => <Row key={a.path} a={a} pt={pt} fact={facts?.get(a.path)} onOpen={() => setOpen(a)} />)}
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
   * The SKILLS this session can invoke.
   *
   * A reference list, not a launcher: invoking one is typing `/name`, which the composer's own
   * picker already does with the draft in front of you. Putting a run button here would be a second
   * way to send something into a session, and the two would disagree the first time one of them
   * learned about arguments.
   *
   * THREE STATES, three sentences: not read yet, none installed, and the host's own reason when it
   * has one (a harness that has no skills at all says so through the route).
   */
  const skillsBody = () => {
    // THE DETAIL IS A SCREEN, not a modal: the panel is already a narrow column, and a dialog over
    // a column that width covers the thing it is about. `esc` and a back row return to the list.
    if (openSkill !== null) {
      const sk = (skills ?? []).find(x => x.name === openSkill)
      return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)',
          }}>
            <button
              onClick={() => setOpenSkill(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, minHeight: 28, padding: '0 8px',
                borderRadius: 7, border: '1px solid var(--border-subtle)', background: 'transparent',
                color: 'var(--text-secondary)', fontFamily: 'inherit', fontSize: 11.5, cursor: 'pointer',
              }}
            >
              <ChevronLeft size={13} />{pt ? 'Skills' : 'Skills'}
            </button>
            <span style={{
              minWidth: 0, flex: 1, fontSize: 12, fontWeight: 650, color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>/{openSkill}</span>
            {/* INVOKE puts the line in the composer; it never sends. What reaches a session is
                what the person pressed enter on — see `composerStore.ts`. */}
            <button
              onClick={() => requestDraft(sessionId, skillInvocation({ name: openSkill, description: '' }))}
              title={pt ? 'Coloca /nome na caixa de mensagem' : 'Puts /name in the message box'}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
                minHeight: 28, padding: '0 10px', borderRadius: 7, cursor: 'pointer',
                border: '1px solid var(--anthropic-orange)',
                background: 'var(--anthropic-orange-dim)', color: 'var(--anthropic-orange)',
                fontFamily: 'inherit', fontSize: 11.5, fontWeight: 650,
              }}
            >
              <Sparkles size={12} />{pt ? 'Usar esta skill' : 'Use this skill'}
            </button>
          </div>
          <div style={{ padding: '10px 12px', overflowY: 'auto', minHeight: 0, flex: 1 }}>
            {sk?.description && (
              <p style={{ margin: '0 0 10px', fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
                {sk.description}
              </p>
            )}
            {skillBody === null ? (
              <Note icon={<Loader size={13} className="ag-working-spin" />}
                text={pt ? 'Lendo a skill…' : 'Reading the skill…'} />
            ) : !skillBody.ok ? (
              <Note text={skillBody.message} />
            ) : (
              <>
                {/* TWO READINGS OF ONE FILE, and both are wanted: a SKILL.md is written to be read
                    (headings, lists, tables) and is also a file whose exact bytes matter when you
                    are about to run it. Formatted by default, source one click away, and the
                    choice is remembered. */}
                <div role="tablist" style={{
                  display: 'flex', gap: 2, padding: 2, marginBottom: 8, borderRadius: 8,
                  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
                  width: 'fit-content',
                }}>
                  {([['md', pt ? 'Formatado' : 'Formatted'], ['text', pt ? 'Texto' : 'Text']] as const)
                    .map(([id, label]) => (
                      <button
                        key={id}
                        role="tab"
                        aria-selected={skillFormat === id}
                        onClick={() => chooseSkillFormat(id)}
                        style={{
                          minHeight: isMobile ? 44 : 24, padding: '0 10px', borderRadius: 6,
                          border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
                          background: skillFormat === id ? 'var(--bg-elevated)' : 'transparent',
                          color: skillFormat === id ? 'var(--anthropic-orange)' : 'var(--text-tertiary)',
                          fontWeight: skillFormat === id ? 650 : 400,
                        }}
                      >{label}</button>
                    ))}
                </div>
                {skillFormat === 'md' ? (
                  <div className="ag-chat-md" style={{
                    fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)',
                    overflowWrap: 'anywhere',
                  }}>
                    {/* The FRONTMATTER is not prose and markdown does not know that: rendered, its
                        `---` becomes a rule and `name:`/`description:` become a paragraph that
                        reads like the skill's first sentence. It is shown as the header it is. */}
                    {(() => {
                      const { front, body } = splitFrontmatter(skillBody.text)
                      return (
                        <>
                          {front !== '' && (
                            <pre style={{
                              margin: '0 0 10px', padding: '8px 10px', borderRadius: 8,
                              background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
                              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                              fontSize: 10.5, lineHeight: 1.55, color: 'var(--text-tertiary)',
                              whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                            }}>{front}</pre>
                          )}
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
                        </>
                      )
                    })()}
                  </div>
                ) : (
                  <pre style={{
                    margin: 0, padding: '10px 12px', borderRadius: 9, overflowX: 'auto',
                    background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
                    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                    fontSize: 11, lineHeight: 1.6, color: 'var(--text-secondary)',
                    whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                  }}>{skillBody.text}</pre>
                )}
                {skillBody.truncated && (
                  <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {pt
                      ? 'Mostrando só o começo — o arquivo é grande.'
                      : 'Showing the beginning only — the file is large.'}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        {skills !== null && skills.length > 0 && (
          <div style={{ padding: '8px 12px', flexShrink: 0 }}>
            <input
              value={skillQuery}
              onChange={e => setSkillQuery(e.target.value)}
              placeholder={pt ? 'Buscar skill…' : 'Search skills…'}
              aria-label={pt ? 'Buscar skill' : 'Search skills'}
              style={{
                width: '100%', boxSizing: 'border-box', minHeight: 30, padding: '0 10px',
                borderRadius: 8, border: '1px solid var(--border-subtle)',
                background: 'var(--bg-base)', color: 'var(--text-primary)',
                fontFamily: 'inherit',
                // 16px on a phone or iOS Safari zooms the viewport — the repo's own rule.
                fontSize: isMobile ? 16 : 12,
              }}
            />
          </div>
        )}
        <div style={{ padding: '0 12px 10px', overflowY: 'auto', minHeight: 0, flex: 1 }}>
          {skills === null ? (
            <Note text={pt ? 'Lendo as skills desta sessão…' : 'Reading this session’s skills…'} />
          ) : skills.length === 0 ? (
            <Note text={skillsNote ?? (pt
              ? 'Nenhuma skill instalada para esta sessão.'
              : 'No skills installed for this session.')} />
          ) : countSkills(skillGroups) === 0 ? (
            // The list is not empty — the SEARCH emptied it, and those are different sentences.
            <Note text={pt
              ? `Nenhuma skill encontrada para “${skillQuery.trim()}”.`
              : `No skill matches “${skillQuery.trim()}”.`} />
          ) : (
            <>
              {skillsNote && (
                <p style={{ margin: '0 0 8px', fontSize: 11, lineHeight: 1.5, color: 'var(--text-tertiary)' }}>
                  {skillsNote}
                </p>
              )}
              {skillGroups.map(group => (
                <Band key={group.key || '_own'} label={`${group.label} · ${group.skills.length}`}>
                  {group.skills.map(sk => (
                    <button
                      key={sk.name}
                      onClick={() => setOpenSkill(sk.name)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 10px', marginBottom: 6, borderRadius: 9, cursor: 'pointer',
                        background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                        fontFamily: 'inherit',
                      }}
                    >
                      <span style={{
                        display: 'block', fontSize: 12, fontWeight: 650, color: 'var(--text-primary)',
                        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                      }}>/{shortName(sk)}</span>
                      {sk.description && (
                        <span style={{
                          display: 'block', marginTop: 3, fontSize: 11, lineHeight: 1.5,
                          color: 'var(--text-tertiary)',
                        }}>{sk.description}</span>
                      )}
                    </button>
                  ))}
                </Band>
              ))}
            </>
          )}
        </div>
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
        sessionId={sessionId}
        groups={gallery}
        lang={lang}
        view={galleryView}
        onViewChange={chooseGalleryView}
        scope={galleryScope}
        onScopeChange={chooseGalleryScope}
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
            : tab === 'skills' ? skillsBody()
            : tab === 'agents' ? agentsBody()
            : tab === 'mcps' ? mcpBody()
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

/** A size a person reads. Two figures is all "how big is this" needs. */
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function Row({ a, pt, fact, onOpen }: {
  a: Artifact; pt: boolean
  fact?: { bytes: number; scope: 'project' | 'temp' }
  onOpen: () => void
}) {
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
        {/* THE FACTS, on one line: how big, how many times it was touched, and whether it is the
            project's or scratch. The scope is said only for TEMP — everything else is the project,
            and a badge on every row would be noise on the common case. */}
        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--text-tertiary)' }}>
          {a.live && (
            <span style={{ color: 'var(--anthropic-orange)' }}>{pt ? 'escrevendo…' : 'writing…'}</span>
          )}
          {fact && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtBytes(fact.bytes)}</span>}
          {a.touches > 1 && <span>{a.touches} {pt ? 'edições' : 'edits'}</span>}
          {fact?.scope === 'temp' && (
            <span style={{
              padding: '0 5px', borderRadius: 4, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3,
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            }}>{pt ? 'temporário' : 'temp'}</span>
          )}
        </span>
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
/**
 * ONE STEP, opened.
 *
 * `local` needs nothing (the text is already in the payload — `stepOpenable`'s rule 2); `remote`
 * asks `/api/fleet/step`, and asks AGAIN only while the server says the step is still running,
 * which is the whole of "expanding in real time". Every rule here is in `lib/stepDetail.ts`.
 */
function useStepDetail(
  sessionId: string, e: LiveEvent, open: boolean, pt: boolean, agentId?: string,
): StepState | null {
  const kind = stepOpenable(e)
  const [state, setState] = useState<StepState | null>(null)

  useEffect(() => {
    if (!open || kind === null) { setState(null); return }
    if (kind === 'local') { setState({ phase: 'local', text: e.full ?? '' }); return }

    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    // The FIRST read shows a spinner; every later one replaces the content in place, so a running
    // step's pane does not blink back to "loading" twice a second while somebody is reading it.
    let first = true

    const read = async () => {
      if (first) setState({ phase: 'loading' })
      try {
        const res = await fetch(stepUrl(sessionId, e.ref!, pt ? 'pt' : 'en', agentId))
        if (!alive) return
        if (!res.ok) {
          setState({ phase: 'failed', message: pt ? 'Não foi possível abrir este passo.' : 'This step could not be opened.' })
          return
        }
        const body = await res.json() as StepPayload
        if (!alive) return
        const next: StepState = body.ok ? { phase: 'ready', step: body } : { phase: 'failed', message: body.message }
        setState(next)
        const wait = stepPollMs(next)
        if (wait !== null) timer = setTimeout(read, wait)
      } catch {
        if (alive) setState({ phase: 'failed', message: pt ? 'Não foi possível abrir este passo.' : 'This step could not be opened.' })
      } finally {
        first = false
      }
    }
    void read()
    return () => { alive = false; if (timer) clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, sessionId, e.ref, e.full, pt, agentId])

  return state
}

/** A block of the session's own bytes — a command, its output, a written file. Scrolls itself. */
function StepBlock({ label, text, tone }: { label: string; text: string; tone?: 'error' }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
        color: tone === 'error' ? '#ef4444' : 'var(--text-tertiary)', marginBottom: 3,
      }}>{label}</div>
      {/* Wide output scrolls INSIDE its own box; the panel body must never scroll sideways. */}
      <pre style={{
        margin: 0, padding: '6px 8px', borderRadius: 6, maxHeight: 260, overflow: 'auto',
        background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
        fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 10.5, lineHeight: 1.5,
        color: 'var(--text-secondary)', whiteSpace: 'pre', tabSize: 2,
      }}>{text}</pre>
    </div>
  )
}

function EventRow({ e, pt, now, onOpen, status, sessionId, agentId }: {
  e: LiveEvent; pt: boolean; now: number; onOpen?: () => void; status?: WriteStatus
  sessionId: string
  /** Set inside a SUBAGENT's activity: its refs live in its own transcript, not the parent's. */
  agentId?: string
}) {
  const [open, setOpen] = useState(false)
  const openable = stepOpenable(e)
  const detail = useStepDetail(sessionId, e, open, pt, agentId)
  const notice = detail ? stepNotice(detail, pt) : null
  const meta: Record<LiveEvent['kind'], { icon: React.ReactNode; color: string; label: string }> = {
    wrote: { icon: <FileEdit size={11} />, color: 'var(--anthropic-orange)', label: pt ? 'escreveu' : 'wrote' },
    read: { icon: <Eye size={11} />, color: 'var(--text-tertiary)', label: pt ? 'leu' : 'read' },
    ran: { icon: <Terminal size={11} />, color: 'var(--text-secondary)', label: pt ? 'rodou' : 'ran' },
    thought: { icon: <Brain size={11} />, color: '#a78bfa', label: pt ? 'pensou' : 'thought' },
    delegated: { icon: <Send size={11} />, color: '#22c55e', label: pt ? 'delegou' : 'delegated' },
  }
  const m = meta[e.kind]
  const mono = e.kind === 'wrote' || e.kind === 'read' || e.kind === 'ran'
  /**
   * THE ROW'S OWN CLICK EXPANDS IT; opening the FILE is a separate control on the right.
   *
   * The row used to be a link to the file, and expanding is now what people actually asked the feed
   * for ("as linhas de execução devem ser clicáveis e EXPANDIR abaixo delas, em tempo real"). Both
   * are kept, and they are two controls rather than one that guesses: on a `wrote` row of a shell
   * command, "show me what ran" and "take me to the file" are different questions and the row
   * cannot know which one was meant.
   */
  const Tag = openable ? 'button' : 'div'
  return (
    <div style={{ borderRadius: 7, background: open ? 'var(--bg-elevated)' : 'transparent' }}>
    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
    <Tag
      {...(openable ? {
        onClick: () => setOpen(v => !v),
        title: e.text,
        'aria-expanded': open,
      } : {})}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 7, padding: '5px 8px',
        opacity: e.live ? 1 : 0.92,
        width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
        borderRadius: 7, fontFamily: 'inherit', minWidth: 0,
        cursor: openable ? 'pointer' : 'default',
      }}
      {...(openable ? {
        onMouseEnter: (ev: React.MouseEvent<HTMLElement>) => { ev.currentTarget.style.background = 'var(--bg-elevated)' },
        onMouseLeave: (ev: React.MouseEvent<HTMLElement>) => { ev.currentTarget.style.background = 'transparent' },
      } : {})}
    >
      {/* The chevron is drawn ONLY where the row opens — rule 1 of `stepDetail.ts`. */}
      <span style={{ color: 'var(--text-tertiary)', paddingTop: 2, flexShrink: 0, width: 11 }}>
        {openable ? (open ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : null}
      </span>
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
        {/* WHY this path is not a link. Without it one row opens and its neighbour does nothing,
            with no way to tell which is which — and "it is scratch" and "it is gone" send a reader
            to two different conclusions about their own work. */}
        {status === 'temp' && (
          <span style={{
            marginLeft: 6, padding: '0 5px', borderRadius: 4, fontSize: 9,
            fontWeight: 700, letterSpacing: 0.3, color: 'var(--text-tertiary)',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          }}>{pt ? 'temporário' : 'temp'}</span>
        )}
        {status === 'gone' && (
          <span style={{
            marginLeft: 6, padding: '0 5px', borderRadius: 4, fontSize: 9,
            fontWeight: 700, letterSpacing: 0.3, color: 'var(--text-tertiary)',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          }}>{pt ? 'não está mais lá' : 'no longer there'}</span>
        )}
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
    {/* Take me to the FILE — the other question this row can answer, and only where the file is
        actually in the Files list. */}
    {onOpen && (
      <button
        onClick={onOpen}
        title={pt ? 'Abrir o arquivo' : 'Open the file'}
        aria-label={pt ? 'Abrir o arquivo' : 'Open the file'}
        style={{
          flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 24, height: 24, margin: '4px 4px 0 0', borderRadius: 6, padding: 0,
          border: '1px solid var(--border-subtle)', background: 'transparent',
          color: 'var(--text-tertiary)', cursor: 'pointer',
        }}
      >
        <ExternalLink size={11} />
      </button>
    )}
    </div>
    {open && (
      <div style={{ padding: '0 8px 8px 26px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {detail === null || detail.phase === 'loading' ? (
          <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>
            {pt ? 'Abrindo o passo…' : 'Opening the step…'}
          </span>
        ) : detail.phase === 'failed' ? (
          // The server's OWN sentence, verbatim: "I cannot open this one" and "there is nothing
          // here" are different facts and this panel does not reword either.
          <span role="status" style={{ fontSize: 10.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
            {detail.message}
          </span>
        ) : detail.phase === 'local' ? (
          <StepBlock label={pt ? 'raciocínio' : 'reasoning'} text={detail.text} />
        ) : (
          <>
            <StepBlock label={detail.step.name} text={detail.step.input} />
            {detail.step.output !== null && detail.step.output !== '' && (
              <StepBlock
                label={detail.step.isError ? (pt ? 'erro' : 'error') : (pt ? 'saída' : 'output')}
                text={detail.step.output}
                {...(detail.step.isError ? { tone: 'error' as const } : {})}
              />
            )}
            {/* A step that produced nothing SAYS so — an empty pane and "it printed nothing" are
                different facts, and only one of them is about the command. */}
            {!detail.step.running && (detail.step.output === null || detail.step.output === '') && (
              <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>
                {pt ? 'Este passo não imprimiu nada.' : 'This step printed nothing.'}
              </span>
            )}
          </>
        )}
        {notice && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{notice}</span>
        )}
      </div>
    )}
    </div>
  )
}

/**
 * ONE SUBAGENT, as a row.
 *
 * The numbers are the point: tokens (ALL FOUR counters — the server sums them through `tokens.ts`)
 * and the cost of them. Where a number does not exist it is REPLACED by the sentence that says why,
 * never printed as a zero — a subagent measured here read 123,6 M cached tokens against 698 fresh
 * ones, so a zero on this row is not a rounding error, it is a wrong answer by a factor of a
 * hundred thousand.
 */
function SubagentCard({ row, pt, now, onOpen }: {
  row: SubagentRow; pt: boolean; now: number; onOpen: () => void
}) {
  const st = subagentStatusText(row.status, pt)
  const unmeasured = unmeasuredText(row, pt)
  const unpriced = unpricedText(row, pt)
  const title = row.description ?? row.agentType ?? row.agentId
  return (
    <button
      onClick={onOpen}
      style={{
        display: 'block', width: '100%', textAlign: 'left', border: '1px solid var(--border-subtle)',
        background: 'transparent', borderRadius: 8, padding: '7px 9px', marginBottom: 6,
        cursor: 'pointer', fontFamily: 'inherit', minWidth: 0,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
          color: st.color, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          {row.status === 'running' && (
            <span aria-hidden style={{
              width: 6, height: 6, borderRadius: '50%', background: st.color,
              animation: 'ag-agent-pulse 1.6s ease-in-out infinite',
            }} />
          )}
          {st.text}
        </span>
        <span style={{
          fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{title}</span>
        {agoLabel(row.lastAt ?? row.startedAt, now, pt) !== '' && (
          <span style={{
            marginLeft: 'auto', flexShrink: 0, fontSize: 10, color: 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
          }}>{agoLabel(row.lastAt ?? row.startedAt, now, pt)}</span>
        )}
      </div>
      <div style={{
        marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '2px 10px',
        fontSize: 10.5, color: 'var(--text-tertiary)', lineHeight: 1.5,
      }}>
        {/* TOKENS: every counter. The breakdown rides the title attribute so the headline can be
            accounted for without spending a row on four numbers. */}
        {row.totalTokens !== null ? (
          <span
            title={row.tokens
              ? `${pt ? 'entrada' : 'input'} ${fmt(row.tokens.input)} · ${pt ? 'saída' : 'output'} ${fmt(row.tokens.output)} · ${pt ? 'cache lido' : 'cache read'} ${fmt(row.tokens.cacheRead)} · ${pt ? 'cache escrito' : 'cache written'} ${fmt(row.tokens.cacheWrite)}`
              : undefined}
          >
            <strong style={{ color: 'var(--text-secondary)' }}>{fmt(row.totalTokens)}</strong> tok
          </span>
        ) : (
          <span>{unmeasured}</span>
        )}
        {row.costUSD !== null
          ? <span><strong style={{ color: 'var(--text-secondary)' }}>{fmtCost(row.costUSD)}</strong></span>
          : unpriced && <span>{unpriced}</span>}
        {row.toolCalls > 0 && <span>{fmt(row.toolCalls)} {pt ? 'chamadas' : 'calls'}</span>}
        {row.modelId && <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{row.modelId}</span>}
        {row.spawnDepth !== undefined && row.spawnDepth > 1 && (
          <span>{pt ? `nível ${row.spawnDepth}` : `depth ${row.spawnDepth}`}</span>
        )}
      </div>
      <style>{`@keyframes ag-agent-pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
    </button>
  )
}

/**
 * ONE SUBAGENT'S OWN ACTIVITY — what it is doing, or what it did.
 *
 * It is the very feed the Live tab draws, over the subagent's own turns, so a subagent's work is
 * read by one implementation rather than a second one that would drift. Its rows open the same way,
 * against the subagent's transcript (`stepUrl`'s `agentId`).
 */
function SubagentActivity({ sessionId, row, pt, now, onBack }: {
  sessionId: string; row: SubagentRow; pt: boolean; now: number; onBack: () => void
}) {
  const [turns, setTurns] = useState<readonly LiveTurn[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const tailRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const res = await fetch(
          `/api/fleet/subagents?id=${encodeURIComponent(sessionId)}&agent=${encodeURIComponent(row.agentId)}&lang=${pt ? 'pt' : 'en'}`,
        )
        if (!alive) return
        const body = await res.json() as { ok: boolean; turns?: LiveTurn[]; message?: string }
        if (!alive) return
        if (!body.ok) { setFailed(body.message ?? (pt ? 'Não foi possível ler este subagente.' : 'This subagent could not be read.')); return }
        setFailed(null)
        setTurns(body.turns ?? [])
        // A RUNNING agent is still writing; a finished one cannot change, so it is read once.
        if (row.status === 'running') timer = setTimeout(read, 3000)
      } catch {
        if (alive) setFailed(pt ? 'Não foi possível ler este subagente.' : 'This subagent could not be read.')
      }
    }
    void read()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [sessionId, row.agentId, row.status, pt])

  const feed = useMemo(() => liveEvents(turns ?? []), [turns])
  // Follow the tail while it is running — the newest step is the one being watched.
  useEffect(() => { if (row.status === 'running') tailRef.current?.scrollIntoView({ block: 'end' }) }, [feed.length, row.status])

  const st = subagentStatusText(row.status, pt)
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', flexShrink: 0,
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <button
          onClick={onBack}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 3, border: 'none', background: 'transparent',
            color: 'var(--text-tertiary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, padding: 0,
          }}
        >
          <ChevronLeft size={13} /> {pt ? 'Subagentes' : 'Subagents'}
        </button>
        <span style={{
          fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)', minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{row.description ?? row.agentType ?? row.agentId}</span>
        <span style={{
          marginLeft: 'auto', flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
          textTransform: 'uppercase', color: st.color,
        }}>{st.text}</span>
      </div>
      {failed !== null ? (
        <Note text={failed} />
      ) : turns === null ? (
        <Note icon={<Loader size={16} />} text={pt ? 'Lendo…' : 'Reading…'} />
      ) : feed.length === 0 ? (
        <Note icon={<Bot size={16} />} text={row.status === 'running'
          ? (pt ? 'Este subagente começou e ainda não fez nada.' : 'This subagent has started and has not done anything yet.')
          : (pt ? 'Este subagente não registrou nenhuma ação.' : 'This subagent recorded no actions.')} />
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 6px 10px' }}>
          {feed.map((e, i) => (
            <EventRow key={i} e={e} pt={pt} now={now} sessionId={sessionId} agentId={row.agentId} />
          ))}
          <div ref={tailRef} />
        </div>
      )}
    </div>
  )
}

/**
 * The MCP panel: the servers, and the one form that adds another.
 *
 * WRITING IS AN EXPLICIT ACT, and its SCOPE is the user's choice — `user` reaches every project on
 * this machine, `project` is written into a repository other people pull. So the picker states what
 * each one does (`scopeText`), a scope that cannot work here is ABSENT rather than present and
 * failing (`offerableScopes`), and a removal names the scope it is removing from, because that is
 * the exact inverse of the install and nothing else is.
 */
function McpTab({ lang, list, error, cwd, onChanged }: {
  lang: 'pt' | 'en'
  list: McpListPayload | null
  error: string | null
  cwd?: string
  onChanged: () => void
}) {
  const pt = lang === 'pt'
  const [adding, setAdding] = useState(false)
  const [paste, setPaste] = useState('')
  const [name, setName] = useState('')
  const [scope, setScope] = useState<McpScope>('user')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const scopes = offerableScopes(cwd)

  const write = async (path: string, body: Record<string, unknown>) => {
    setBusy(true)
    setSaid(null)
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, lang, ...(cwd ? { projectPath: cwd } : {}) }),
      })
      const out = await res.json() as { ok: boolean; names?: string[]; message?: string }
      if (out.ok) {
        setSaid({ tone: 'ok', text: (out.names ?? []).join(', ') })
        setPaste(''); setName(''); setAdding(false)
        onChanged()
      } else {
        // The SERVER's own sentence, verbatim — including the harness command's own error, which
        // says far more about a refused config than any wording invented here.
        setSaid({ tone: 'bad', text: out.message ?? (pt ? 'não deu certo' : 'that did not work') })
      }
    } catch {
      setSaid({ tone: 'bad', text: pt ? 'não foi possível falar com o servidor' : 'the server could not be reached' })
    } finally { setBusy(false) }
  }

  if (error !== null) return <Note icon={<Plug size={16} />} text={error} />
  if (list === null) return <Note icon={<Loader size={16} />} text={pt ? 'Lendo os MCPs…' : 'Reading the MCP servers…'} />

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 6px 10px' }}>
      {/* The one thing a machine without the harness's CLI cannot do, said before anything offers
          to do it. */}
      {!list.canWrite && (
        <p style={{
          margin: '0 2px 8px', fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-tertiary)',
          border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '6px 8px',
        }}>{cannotWriteText(pt)}</p>
      )}

      {list.servers.length === 0 && (
        <Note icon={<Plug size={16} />} text={pt
          ? 'Nenhum servidor MCP configurado para esta máquina ou este projeto.'
          : 'No MCP server is configured for this machine or this project.'} />
      )}

      {list.servers.map(s => (
        <McpRow
          key={`${s.scope}:${s.name}`} entry={s} pt={pt} canWrite={list.canWrite} busy={busy}
          onRemove={() => void write('/api/mcp/remove', { name: s.name, scope: s.scope })}
        />
      ))}

      {list.canWrite && !adding && (
        <button
          onClick={() => { setAdding(true); setSaid(null) }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6,
            padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 11.5, fontWeight: 600, border: '1px dashed var(--border)',
            background: 'transparent', color: 'var(--text-secondary)',
          }}
        >
          <Plus size={12} /> {pt ? 'Adicionar um MCP' : 'Add an MCP'}
        </button>
      )}

      {adding && (
        <form
          onSubmit={e => { e.preventDefault(); void write('/api/mcp/install', { paste, scope, ...(name ? { name } : {}) }) }}
          style={{
            marginTop: 8, padding: 8, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 7,
            border: '1px solid var(--border-subtle)',
          }}
        >
          <p style={{ margin: 0, fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-tertiary)' }}>
            {pt
              ? 'Cole o JSON do servidor — o bloco `mcpServers` inteiro, uma entrada nomeada, ou só a configuração (aí o nome é obrigatório).'
              : 'Paste the server’s JSON — the whole `mcpServers` block, one named entry, or just the config (then the name is required).'}
          </p>
          <textarea
            value={paste}
            onChange={e => setPaste(e.target.value)}
            rows={5}
            spellCheck={false}
            placeholder={'{"mcpServers":{"sentry":{"type":"http","url":"https://mcp.sentry.dev/mcp"}}}'}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 6, resize: 'vertical',
              border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 11, lineHeight: 1.5,
            }}
          />
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={pt ? 'Nome (só se o JSON não trouxer um)' : 'Name (only if the JSON carries none)'}
            style={{
              width: '100%', boxSizing: 'border-box', minHeight: 30, padding: '0 8px', borderRadius: 6,
              border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              fontFamily: 'inherit',
            }}
          />
          {/* THE SCOPE, with what it MEANS beside it. A scope that cannot work here is absent. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {scopes.map(sc => {
              const t = scopeText(sc, pt)
              const on = scope === sc
              return (
                <label
                  key={sc}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 7, padding: '5px 7px', borderRadius: 6,
                    cursor: 'pointer', border: `1px solid ${on ? 'var(--anthropic-orange)' : 'var(--border-subtle)'}`,
                  }}
                >
                  <input
                    type="radio" name="mcp-scope" checked={on} onChange={() => setScope(sc)}
                    style={{ marginTop: 2, accentColor: 'var(--anthropic-orange)' }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary)' }}>{t.label}</span>
                    <span style={{ display: 'block', fontSize: 10.5, lineHeight: 1.45, color: 'var(--text-tertiary)' }}>{t.reach}</span>
                  </span>
                </label>
              )
            })}
            {!cwd && (
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                {pt
                  ? 'Esta sessão não tem um diretório registrado, então só o escopo desta máquina pode ser oferecido.'
                  : 'This session has no recorded directory, so only the machine-wide scope can be offered.'}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="submit"
              disabled={busy || paste.trim() === ''}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 7,
                fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600,
                cursor: busy || paste.trim() === '' ? 'default' : 'pointer',
                opacity: busy || paste.trim() === '' ? 0.5 : 1,
                border: '1px solid var(--anthropic-orange)', background: 'var(--anthropic-orange)', color: '#fff',
              }}
            >
              <Plus size={12} /> {busy ? (pt ? 'Adicionando…' : 'Adding…') : (pt ? 'Adicionar' : 'Add')}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setSaid(null) }}
              style={{
                padding: '5px 11px', borderRadius: 7, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600,
                cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-card)',
                color: 'var(--text-secondary)',
              }}
            >{pt ? 'Cancelar' : 'Cancel'}</button>
          </div>
        </form>
      )}

      {said && (
        <p role="status" style={{
          margin: '8px 2px 0', fontSize: 10.5, lineHeight: 1.5,
          color: said.tone === 'ok' ? '#22c55e' : '#ef4444',
        }}>
          {said.tone === 'ok'
            ? (pt ? `Pronto: ${said.text}` : `Done: ${said.text}`)
            : said.text}
        </p>
      )}
    </div>
  )
}

/** One configured server: what it is, where it is configured, and what it is doing right now. */
function McpRow({ entry, pt, canWrite, busy, onRemove }: {
  entry: McpEntry; pt: boolean; canWrite: boolean; busy: boolean; onRemove: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const run = runText(entry.run, pt)
  const sc = scopeText(entry.scope, pt)
  return (
    <div style={{
      border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '7px 9px', marginBottom: 6,
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
          color: run.color, flexShrink: 0,
        }}>{run.text}</span>
        <span style={{
          fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{entry.name}</span>
        <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 10, color: 'var(--text-tertiary)' }}>{sc.label}</span>
        {canWrite && (
          <button
            onClick={() => setConfirm(v => !v)}
            disabled={busy}
            title={pt ? 'Remover' : 'Remove'}
            aria-label={pt ? 'Remover' : 'Remove'}
            style={{
              flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, borderRadius: 6, padding: 0, cursor: busy ? 'default' : 'pointer',
              border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-tertiary)',
            }}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
      {/* WHY the status says what it says — the sentence, never a colour alone. */}
      {run.detail && (
        <div style={{ marginTop: 3, fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-tertiary)' }}>{run.detail}</div>
      )}
      <div style={{
        marginTop: 3, fontSize: 10.5, color: 'var(--text-tertiary)', wordBreak: 'break-word',
        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
      }}>
        {entry.url ?? [entry.command, ...(entry.args ?? [])].filter(Boolean).join(' ')}
      </div>
      {/* Environment VARIABLE NAMES only. One configured server here holds a database URI with
          credentials in it, and a value that reaches this panel is on a screen forever. */}
      {entry.envKeys && entry.envKeys.length > 0 && (
        <div style={{ marginTop: 3, fontSize: 10, color: 'var(--text-tertiary)' }}>
          {pt ? 'variáveis: ' : 'env: '}{entry.envKeys.join(', ')}
        </div>
      )}
      {confirm && (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* The removal NAMES the scope it removes from — the exact inverse of the install, and
              nothing else is. */}
          <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {pt ? `Remover "${entry.name}" de: ${sc.label} — ${sc.reach}?` : `Remove "${entry.name}" from: ${sc.label} — ${sc.reach}?`}
          </span>
          <button
            onClick={() => { setConfirm(false); onRemove() }}
            style={{
              padding: '3px 10px', borderRadius: 6, fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', border: '1px solid #ef4444', background: 'transparent', color: '#ef4444',
            }}
          >{pt ? 'Remover' : 'Remove'}</button>
          <button
            onClick={() => setConfirm(false)}
            style={{
              padding: '3px 10px', borderRadius: 6, fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
              cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-card)',
              color: 'var(--text-secondary)',
            }}
          >{pt ? 'Cancelar' : 'Cancel'}</button>
        </div>
      )}
    </div>
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
