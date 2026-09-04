/**
 * GalleryTab — the files a person SENT this session, grouped by the message that carried them.
 *
 * The opposite direction from the panel's other three tabs. Files, Docs and Live all answer "what
 * did this session DO"; this answers "what did I give it" — and the grouping is the whole point:
 * three screenshots of one broken layout went up together, about one thing, under one sentence, and
 * a flat wall of thumbnails throws that away.
 *
 * IT DECIDES NOTHING. `gallery.ts` says which messages carried files, in what order, and what a
 * file's format is; `useAttachmentSizes` asks the server for the sizes and leaves out the ones it
 * could not get. This file draws them.
 *
 * TWO VIEWS OF ONE LIST. The grid shows the picture plus everything the list shows; the list drops
 * the picture and keeps the name, the size and the format. They are not two arrangements of
 * different material — the same groups, in the same order, under the same headings.
 *
 * A FILE THAT CANNOT BE PREVIEWED SAYS SO. It is never a broken image: the format is read from the
 * name before anything is requested, and a request that fails anyway (the file was deleted, the
 * route refused it) falls back to the same card. An absent thumbnail is a fact; a broken one is a
 * bug the reader has to diagnose.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileQuestion, Grid2x2, Images, List, Paperclip } from 'lucide-react'
import { agoLabel } from '../../lib/artifactTabs'
import { formatBytes, type GalleryFile, type GalleryGroup, type GalleryView } from '../../lib/gallery'
import { attachmentNameUrl } from '../../lib/attachmentUrl'
import { useAttachmentSizes } from '../../hooks/useAttachmentSizes'
import { useIsMobile } from '../../hooks/useIsMobile'

export interface GalleryTabProps {
  groups: readonly GalleryGroup[]
  lang: 'pt' | 'en'
  view: GalleryView
  onViewChange: (view: GalleryView) => void
}

export function GalleryTab({ groups, lang, view, onViewChange }: GalleryTabProps) {
  const pt = lang === 'pt'
  const isMobile = useIsMobile()

  const names = useMemo(
    () => groups.flatMap(g => g.files.filter(f => f.image).map(f => f.name)),
    [groups],
  )
  const sizes = useAttachmentSizes(names)

  /** A clock, so "3m" ages while the panel is open rather than freezing at its first render. */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  /** A preview the browser could not load after all — the file is gone, or was never one. */
  const [broken, setBroken] = useState<Record<string, true>>({})
  const markBroken = useCallback((name: string) => {
    setBroken(prev => (prev[name] ? prev : { ...prev, [name]: true }))
  }, [])

  if (groups.length === 0) {
    return (
      <Empty text={pt
        ? 'Nada enviado nesta conversa ainda. Imagens e arquivos que você anexar a uma mensagem aparecem aqui, agrupados pela mensagem que os levou.'
        : 'Nothing sent in this conversation yet. Images and files you attach to a message appear here, grouped by the message that carried them.'} />
    )
  }

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
        padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)',
      }}>
        <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginRight: 'auto' }}>
          {groups.length} {pt
            ? (groups.length === 1 ? 'mensagem' : 'mensagens')
            : (groups.length === 1 ? 'message' : 'messages')}
        </span>
        <ViewButton
          on={view === 'list'} isMobile={isMobile}
          label={pt ? 'Lista' : 'List'} icon={<List size={13} />}
          onClick={() => onViewChange('list')}
        />
        <ViewButton
          on={view === 'grid'} isMobile={isMobile}
          label={pt ? 'Grade' : 'Grid'} icon={<Grid2x2 size={13} />}
          onClick={() => onViewChange('grid')}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '6px 8px 12px' }}>
        {groups.map(group => (
          <section key={group.index} style={{ marginBottom: 14, minWidth: 0 }}>
            <GroupHeading group={group} pt={pt} now={now} />
            {view === 'grid' ? (
              <div style={{
                display: 'grid', gap: 8,
                // `auto-fill` with a minimum, so the same rule holds at 390px (one or two columns)
                // and at a 900px-wide panel. Nothing here has a fixed width, so the page can never
                // be made to scroll sideways by a picture.
                gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))',
              }}>
                {group.files.map((file, i) => (
                  <Tile
                    key={`${file.path}-${i}`}
                    file={file} pt={pt} isMobile={isMobile}
                    size={sizes[file.name]}
                    broken={broken[file.name] === true}
                    onBroken={() => markBroken(file.name)}
                  />
                ))}
              </div>
            ) : (
              group.files.map((file, i) => (
                <RowItem
                  key={`${file.path}-${i}`}
                  file={file} pt={pt} isMobile={isMobile}
                  size={sizes[file.name]}
                />
              ))
            )}
          </section>
        ))}
      </div>

    </>
  )
}

/** The heading over one message's files: when it was sent, how many, and what was typed. */
function GroupHeading({ group, pt, now }: { group: GalleryGroup; pt: boolean; now: number }) {
  const when = agoLabel(group.at, now, pt)
  const n = group.files.length
  return (
    <div style={{ margin: '2px 2px 6px', minWidth: 0 }}>
      <p style={{
        margin: 0, display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
        color: 'var(--text-tertiary)',
      }}>
        <Paperclip size={10} style={{ flexShrink: 0 }} />
        {n} {pt ? (n === 1 ? 'arquivo' : 'arquivos') : (n === 1 ? 'file' : 'files')}
        {/* WHEN it was sent. Absent when the transcript carried no timestamp — nothing invented,
            the same rule the live feed follows. */}
        {when !== '' && (
          <span
            title={group.at ? new Date(group.at).toLocaleString() : undefined}
            style={{ fontWeight: 600, letterSpacing: 0.3, textTransform: 'none' }}
          >· {when}</span>
        )}
      </p>
      {/* What was typed with them. A message with files and NO words is kept (the files are the
          message) and simply has no line here. */}
      {group.text !== '' && (
        <p style={{
          margin: '3px 0 0', fontSize: 11.5, lineHeight: 1.45, color: 'var(--text-secondary)',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden', overflowWrap: 'anywhere',
        }}>{group.text}</p>
      )}
    </div>
  )
}

/** NAME, SIZE, FORMAT — the list row, and the bottom half of every tile. */
function FileFacts({ file, size, pt }: { file: GalleryFile; size: number | undefined; pt: boolean }) {
  const bytes = formatBytes(size)
  return (
    <>
      <span style={{
        display: 'block', fontSize: 12, color: 'var(--text-primary)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{file.name}</span>
      <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-tertiary)' }}>
        {/* The FORMAT is read from the name, so it is always there when the name has one. The SIZE
            comes from the server and is simply ABSENT when it could not be obtained — never a `0 B`
            standing in for "not known". */}
        {file.format !== '' && file.format}
        {file.format !== '' && bytes !== '' && ' · '}
        {bytes}
        {!file.image && (
          <span style={{ marginLeft: file.format !== '' || bytes !== '' ? 6 : 0 }}>
            {pt ? '· sem prévia' : '· no preview'}
          </span>
        )}
      </span>
    </>
  )
}

function RowItem({ file, size, pt, isMobile }: {
  file: GalleryFile
  size: number | undefined
  pt: boolean
  isMobile: boolean
}) {
  return (
    <div
      title={file.path}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0,
        minHeight: isMobile ? 44 : 0, padding: '6px 6px', borderRadius: 8,
      }}
    >
      <span style={{ flexShrink: 0, color: 'var(--text-tertiary)', display: 'flex' }}>
        {file.image ? <Images size={14} /> : <FileQuestion size={14} />}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <FileFacts file={file} size={size} pt={pt} />
      </span>
    </div>
  )
}

function Tile({ file, size, pt, isMobile, broken, onBroken }: {
  file: GalleryFile
  size: number | undefined
  pt: boolean
  isMobile: boolean
  broken: boolean
  onBroken: () => void
}) {
  const previewable = file.image && !broken
  return (
    <div
      title={file.path}
      style={{
        display: 'flex', flexDirection: 'column', minWidth: 0,
        border: '1px solid var(--border-subtle)', borderRadius: 10, overflow: 'hidden',
        background: 'var(--bg-elevated)',
      }}
    >
      <div style={{
        aspectRatio: '4 / 3', display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: isMobile ? 44 : 0, background: 'var(--bg-base)', overflow: 'hidden',
      }}>
        {previewable ? (
          <img
            src={attachmentNameUrl(file.name)}
            alt={file.name}
            loading="lazy"
            // A preview that fails is not left as a broken image: the tile falls back to the same
            // card a non-image gets, which says in words that there is nothing to show.
            onError={onBroken}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <span style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            padding: 8, textAlign: 'center', color: 'var(--text-tertiary)',
          }}>
            <FileQuestion size={18} />
            <span style={{ fontSize: 10, lineHeight: 1.3 }}>
              {broken
                ? (pt ? 'não está mais no disco' : 'no longer on disk')
                : (pt ? 'sem prévia' : 'no preview')}
            </span>
          </span>
        )}
      </div>
      <div style={{ padding: '6px 7px', minWidth: 0 }}>
        <FileFacts file={file} size={size} pt={pt} />
      </div>
    </div>
  )
}

function ViewButton({ on, isMobile, label, icon, onClick }: {
  on: boolean; isMobile: boolean; label: string; icon: React.ReactNode; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      title={label}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        minHeight: isMobile ? 44 : 26, minWidth: isMobile ? 44 : 0,
        padding: '4px 9px', borderRadius: 7, border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 11.5, fontWeight: on ? 700 : 500,
        background: on ? 'var(--bg-elevated)' : 'transparent',
        color: on ? 'var(--text-primary)' : 'var(--text-tertiary)',
      }}
    >
      {icon}
      {label}
    </button>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px 18px',
    }}>
      <p style={{
        margin: 0, fontSize: 12, lineHeight: 1.6, textAlign: 'center', color: 'var(--text-tertiary)',
      }}>{text}</p>
    </div>
  )
}
