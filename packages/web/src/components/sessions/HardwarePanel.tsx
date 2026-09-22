/**
 * HardwarePanel — the hardware surface, as a RIGHT-SLOT panel (design §1, item 3).
 *
 * `HardwareModal.tsx` used to be the only way to read this: a dialog reached from a header chip.
 * That chip is now folded into the header's one panel switcher (item 2) alongside Contents, Studio,
 * Claude Code and Shell, so the surface it opens has to be a PANEL like the other three — the same
 * box, not a dialog floating over it. `panelSlots.ts` carries `hardware` RIGHT ONLY: a band under
 * the composer has no useful shape for three columns of figures, and nobody asked for it there.
 *
 * The CONTENT is shared with the modal (`HardwareBody`, `useHardwareSnapshot`) rather than
 * reimplemented — one figure, one poll, one 403 sentence. The modal survives unchanged for the
 * mobile "More" sheet tile, where a dialog is still the right shape (see that file's own header).
 */

import type { ReactNode } from 'react'
import { Cpu, X } from 'lucide-react'
import type { Lang } from '@agentistics/core'
import { HardwareBody, useHardwareSnapshot } from '../HardwareModal'
import { useIsMobile } from '../../hooks/useIsMobile'

export interface HardwarePanelProps {
  lang: Lang
  onClose: () => void
  /**
   * Suppress this header's own close button — the exact same convention `ArtifactsAside` already
   * carries (`hideCloseButton`'s own doc comment there): the right slot's `PanelFixedControls`
   * minimize IS a close for this panel (`panelMenu.ts`'s `close-right`), so a second X here would be
   * the same control twice. The bottom band's own minimize COLLAPSES instead, so this button keeps
   * its job there — absent (the default) keeps the close button, matching every caller before this.
   */
  hideCloseButton?: boolean
  /**
   * THE PANEL'S OWN FULL-SCREEN/MINIMIZE/GEAR, folded into this header's row — see
   * `ArtifactsAsideProps.headerControls`'s own header for why this replaced a second, separate strip
   * above this one. Absent draws nothing trailing (the bottom band's own bar already carries them).
   */
  controls?: ReactNode
}

export function HardwarePanel({ lang, onClose, hideCloseButton, controls }: HardwarePanelProps) {
  const pt = lang === 'pt'
  const isMobile = useIsMobile()
  const { hardware, error, lastRefreshed } = useHardwareSnapshot(lang)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, minWidth: 0,
        padding: '10px 12px', borderBottom: '1px solid var(--border)',
      }}>
        <Cpu size={15} style={{ color: 'var(--anthropic-orange)', flexShrink: 0 }} />
        {/* THE TITLE TRUNCATES, THE CONTROLS NEVER MOVE — same rule, same reason, as
            `ArtifactsAside`'s own header row (owner: "um painel cujo título é longo não deve
            empurrar os controles para fora da linha"). */}
        <span style={{
          fontSize: 12, fontWeight: 700, letterSpacing: 0.3, color: 'var(--text-primary)',
          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {pt ? 'Recursos de hardware' : 'Hardware resources'}
        </span>
        {lastRefreshed && (
          <span style={{
            fontSize: 10.5, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums',
            flexShrink: 0,
          }}>
            {pt ? 'Atualizado às' : 'Updated'} {lastRefreshed.toLocaleTimeString()}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {/* NO REFRESH BUTTON (owner: "o de refresh n faz sentido, remove") — `useHardwareSnapshot`
            already polls every 5s for as long as this panel is mounted (that hook's own header
            comment), which is exactly what keeps `lastRefreshed` moving above; a manual refresh on a
            figure that is never more than 5s stale is a control with nothing to do that a real
            refresh would not already have done on its own within the same handful of seconds. */}
        {!hideCloseButton && (
          <button className="ag-tap-icon"
            onClick={onClose}
            title={pt ? 'Fechar' : 'Close'}
            aria-label={pt ? 'Fechar o painel de hardware' : 'Close the hardware panel'}
            style={panelIconBtn}
          >
            <X size={13} />
          </button>
        )}
        {controls}
      </header>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: isMobile ? 12 : 16 }}>
        <HardwareBody lang={lang} hardware={hardware} error={error} isMobile={isMobile} />
      </div>
    </div>
  )
}

const panelIconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 22, flexShrink: 0, borderRadius: 6, padding: 0,
  border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', cursor: 'pointer',
}
