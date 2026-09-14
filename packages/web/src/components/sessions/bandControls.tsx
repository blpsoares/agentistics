import type { ReactNode } from 'react'

/**
 * bandControls.tsx — ONE height, ONE padding, ONE icon/label size for every control drawn on the
 * bottom band's own bar, the right slot's fixed-header switcher and the Studio bar (design item 3,
 * screenshot 1 — "the buttons are non-standard sizes and it is very confusing").
 *
 * BEFORE THIS FILE, the same idea existed at least THREE times and had already drifted from itself:
 * `ShellBand.tsx`'s `labeledBtn` (a bordered pill, height 22, no `boxSizing`, so its rendered box was
 * really 24px once the 1px border either side is added back), `SessionPanel.tsx`'s
 * `studioBandLabeledBtn`/`studioBandIconBtn` (byte-for-byte copies of the same numbers, kept as a
 * SECOND definition rather than an import), and `Studio.tsx`'s `LabeledIconButton` (the same 22px
 * height, but `border: 'none'` and `background: 'transparent'` — a ghost button standing next to
 * bordered pills of a different actual height). None of the three disagreed on purpose; they just
 * never shared a body. `SessionPanel.tsx` even exported a `Segment` component with a comment saying
 * exactly this ("a second hand-rolled copy of it is exactly the drift this whole lift-up was meant
 * to remove") and then nothing ever imported it — `ShellBand.tsx`'s own segmented tablists
 * (`targetSwitch`/`dockedTargetSwitch`) hand-rolled their buttons anyway.
 *
 * THE FIX IS `boxSizing: 'border-box'` PLUS AN EXPLICIT `height` ON EVERY BOX THAT CAN CARRY ONE —
 * including the segment's own WRAPPER, not only the pills beside it. A wrapper sized by its content
 * (`padding: 3` around a 22px button) measures 28px tall while a standalone pill beside it measures
 * 22-24px: same "control", visibly different heights, which is the whole complaint. Fixing the
 * wrapper's height explicitly and giving its tabs `height: '100%'` is what makes
 * `getBoundingClientRect().height` agree across every control this file exports.
 */

/** The one height every desktop control in this family shares. Mobile targets are always 44px
 *  (the house rule), never this figure — every component below takes `isMobile` and switches. */
export const BAND_CONTROL_H = 26

const pillBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, flexShrink: 0,
  boxSizing: 'border-box', border: '1px solid var(--border-subtle)', borderRadius: 6,
  background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
}

/**
 * An icon plus a short visible word, in a bordered pill — "Mover para a direita", "Tela cheia",
 * "Encerrar shell", "Recolher"/"Expandir", "Mostrar/Ocultar árvore", "Árvore à direita/esquerda".
 * The ONE control every labelled action button in the band/Studio-bar family renders through.
 */
export function BandLabeledButton({
  label, visibleText, isMobile, onClick, pressed, children,
}: {
  /** The full sentence — the tooltip, and what a screen reader announces. */
  label: string
  /** The short word actually painted next to the icon. */
  visibleText: string
  isMobile: boolean
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  /** Present only for a toggle (the tree collapse/expand); omitted for a plain action. */
  pressed?: boolean
  children: ReactNode
}) {
  return (
    <button
      className="ag-tap-icon"
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      {...(pressed !== undefined ? { 'aria-pressed': pressed } : {})}
      style={{
        ...pillBase,
        height: isMobile ? 44 : BAND_CONTROL_H,
        padding: isMobile ? '0 12px' : '0 8px',
      }}
    >
      {children}
      <span>{visibleText}</span>
    </button>
  )
}

/**
 * The segmented tablist's own wrapper — "Claude Code | Shell | Studio", the right slot's header
 * switcher, "which terminal". `height` is fixed and `boxSizing: 'border-box'` on the wrapper itself,
 * so its own padding is spent INSIDE that figure rather than added on top of it — the exact defect
 * this file's header describes (a 28px box next to 22-24px pills).
 */
export function BandSegment({ label, isMobile, children }: {
  label: string
  isMobile: boolean
  children: ReactNode
}) {
  return (
    <div role="tablist" aria-label={label} style={{
      display: 'flex', alignItems: 'center', gap: 3, padding: '0 3px', flexShrink: 0,
      boxSizing: 'border-box', height: isMobile ? 44 : BAND_CONTROL_H,
      borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
    }}>
      {children}
    </div>
  )
}

/** One tab inside a `BandSegment` — `height: '100%'` fills the wrapper's own fixed height exactly,
 *  rather than repeating a second number that could drift from it. */
export function BandSegmentTab({ on, onClick, icon, label, isMobile, title }: {
  on: boolean
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  icon?: ReactNode
  label: ReactNode
  isMobile?: boolean
  /** The fuller tooltip sentence. The tab's ACCESSIBLE NAME is always its visible text content
   *  (`label`), never this — a tag folded into `label` (design item 1's "the tag is also part of
   *  the tab's accessible name") would otherwise be lost the moment a caller also set `aria-label`. */
  title?: string
}) {
  return (
    <button
      role="tab"
      aria-selected={on}
      onClick={onClick}
      type="button"
      {...(title !== undefined ? { title } : {})}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
        height: '100%', padding: isMobile ? '0 14px' : '0 9px',
        borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', border: 'none',
        fontSize: 11, fontWeight: 650, whiteSpace: 'nowrap',
        background: on ? 'var(--bg-surface)' : 'transparent',
        color: on ? 'var(--text-primary)' : 'var(--text-tertiary)',
      }}
    >
      {icon}
      {label}
    </button>
  )
}
