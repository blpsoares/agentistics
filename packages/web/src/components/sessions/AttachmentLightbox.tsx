/**
 * AttachmentLightbox — one image attachment, full-size, with a way to step through its siblings.
 *
 * Scoped to the message that opened it: "if there's more than one" (the ask this answers) means
 * more than one attachment on THIS turn, not a scroll through every image in the conversation —
 * jumping to some other message's picture from here would answer a question nobody asked.
 */

import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { attachmentUrl } from '../../lib/attachmentUrl'

export interface AttachmentLightboxProps {
  paths: readonly string[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  lang: 'pt' | 'en'
}

export function AttachmentLightbox({ paths, index, onIndexChange, onClose, lang }: AttachmentLightboxProps) {
  const pt = lang === 'pt'
  const many = paths.length > 1

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (many && e.key === 'ArrowLeft') onIndexChange((index - 1 + paths.length) % paths.length)
      else if (many && e.key === 'ArrowRight') onIndexChange((index + 1) % paths.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, many, paths.length, onIndexChange, onClose])

  const path = paths[index]
  if (path === undefined) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <button
        onClick={onClose}
        aria-label={pt ? 'Fechar' : 'Close'}
        style={{
          position: 'absolute', top: 16, right: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 38, height: 38, borderRadius: 10, cursor: 'pointer',
          border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)',
          color: '#fff',
        }}
      >
        <X size={18} />
      </button>

      {many && (
        <>
          <NavButton
            side="left"
            label={pt ? 'Anterior' : 'Previous'}
            onClick={e => { e.stopPropagation(); onIndexChange((index - 1 + paths.length) % paths.length) }}
          />
          <NavButton
            side="right"
            label={pt ? 'Próxima' : 'Next'}
            onClick={e => { e.stopPropagation(); onIndexChange((index + 1) % paths.length) }}
          />
        </>
      )}

      <img
        src={attachmentUrl(path)}
        alt=""
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: '90vw', maxHeight: '86vh', objectFit: 'contain',
          borderRadius: 8, boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      />

      {many && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          padding: '5px 12px', borderRadius: 999,
          background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.85)',
          fontSize: 12, fontWeight: 600,
        }}>
          {index + 1} / {paths.length}
        </div>
      )}
    </div>
  )
}

function NavButton({ side, label, onClick }: {
  side: 'left' | 'right'; label: string; onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        position: 'absolute', [side]: 16, top: '50%', transform: 'translateY(-50%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 44, height: 44, borderRadius: '50%', cursor: 'pointer',
        border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)',
        color: '#fff',
      } as React.CSSProperties}
    >
      {side === 'left' ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
    </button>
  )
}
