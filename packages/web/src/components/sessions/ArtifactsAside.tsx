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
 * THREE EMPTY STATES, THREE SENTENCES, and never one shared empty box. "The conversation has not
 * loaded", "this session has written nothing" and "this harness cannot be read this way" are
 * different facts, and only the second is a statement about the session's work. The third reuses
 * `/api/fleet/chat`'s own `unavailable` sentence verbatim rather than inventing a second wording
 * for the same refusal.
 */

import { useState } from 'react'
import { FileEdit, FilePlus2, PanelRightClose, Loader } from 'lucide-react'
import type { Artifact } from '../../lib/sessionArtifacts'
import { ArtifactDoc } from './ArtifactDoc'

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
}

/** `new` and `edited` read at a glance from the glyph; the word is beside it for everyone else. */
function KindIcon({ kind }: { kind: Artifact['kind'] }) {
  return kind === 'new'
    ? <FilePlus2 size={13} style={{ color: 'var(--accent-green, #22c55e)', flexShrink: 0 }} />
    : <FileEdit size={13} style={{ color: 'var(--anthropic-orange)', flexShrink: 0 }} />
}

export function ArtifactsAside({
  sessionId, lang, artifacts, loading, unavailable, unlistedWrites, onClose,
}: ArtifactsAsideProps) {
  const pt = lang === 'pt'
  const [open, setOpen] = useState<Artifact | null>(null)

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
    return (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 6px 10px' }}>
        {live.length > 0 && (
          <Band label={pt ? 'agora' : 'now'}>
            {live.map(a => <Row key={a.path} a={a} pt={pt} onOpen={() => setOpen(a)} />)}
          </Band>
        )}
        {past.length > 0 && (
          <Band label={live.length > 0 ? (pt ? 'antes' : 'earlier') : undefined}>
            {past.map(a => <Row key={a.path} a={a} pt={pt} onOpen={() => setOpen(a)} />)}
          </Band>
        )}
        {/* A list that is INCOMPLETE says so where it ends. Without this the reader would take
            these rows for everything the session wrote. */}
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0 }}>
      {open ? (
        <ArtifactDoc sessionId={sessionId} artifact={open} lang={lang} onBack={() => setOpen(null)} />
      ) : (
        <>
          {header}
          {body()}
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
