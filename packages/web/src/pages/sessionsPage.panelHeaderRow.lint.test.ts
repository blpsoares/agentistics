/**
 * sessionsPage.panelHeaderRow.lint.test.ts — EVERY RIGHT-SLOT PANEL HAS ONE HEADER ROW.
 *
 * Owner: "todos os componentes desse aside devem ser assim cara, nao deve ter um header vazio, os
 * icones de maximizar, minimizar etc devem ficar na mesma linha do titulo, ambos dividindo a mesma
 * linha." Two screenshots (Hardware, Skills) each showed a strip carrying only the full-screen and
 * minimize icons, with the panel's own title/counts row drawn BELOW it — two rows for one panel, the
 * top one empty of everything but the trio.
 *
 * THE FIX IS ONE BUILDER, `panelFixedControlsFor` (`SessionsPage.tsx`), reused three ways:
 *  - `cli`/`shell` — no header of their own, so `rightSlotBar` still wraps it in a thin row of its
 *    own (now carrying the panel's NAME too, left-aligned, where it used to be a controls-only
 *    strip).
 *  - `hardware` — the trio is now a `controls` PROP folded into `HardwarePanel`'s own header row.
 *  - the ten former Contents tabs — the trio is now a `headerControls` PROP folded into
 *    `ArtifactsAside`'s own header row.
 * Both of the latter two STOP being drawn by a separate `rightSlotBar(...)` call above the panel —
 * that call is exactly the second, empty row the screenshots show.
 *
 * Not reachable by rendering: none of `SessionsPage`, `ArtifactsAside`'s ten-tab switch or
 * `HardwarePanel`'s poll can mount in this package (no jsdom, no fleet host — see
 * `sessionsPage.lint.test.ts`'s own header for the same fact about this exact file). The SHAPE is
 * what is asserted, over comment-free source, with a planted reversion per file proving the scans
 * still see the bug they pin.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from '../lib/stripComments'

const PAGE_RAW = readFileSync(join(import.meta.dir, 'SessionsPage.tsx'), 'utf-8')
const PAGE_SRC = stripComments(PAGE_RAW)
const HARDWARE_RAW = readFileSync(join(import.meta.dir, '../components/sessions/HardwarePanel.tsx'), 'utf-8')
const HARDWARE_SRC = stripComments(HARDWARE_RAW)
const ARTIFACTS_RAW = readFileSync(join(import.meta.dir, '../components/sessions/ArtifactsAside.tsx'), 'utf-8')
const ARTIFACTS_SRC = stripComments(ARTIFACTS_RAW)

describe('SessionsPage — hardware and the tab panels no longer call the separate controls-only row', () => {
  test('one builder for the trio, defined once', () => {
    expect(PAGE_SRC.match(/const panelFixedControlsFor = \(/g)?.length).toBe(1)
  })

  test('the right-slot Hardware branch renders no `rightSlotBar(\'hardware\'` row', () => {
    expect(PAGE_SRC).not.toContain("rightSlotBar('hardware'")
  })

  test('the right-slot tab-panel branch renders no `rightSlotBar(slotLayout.right` row', () => {
    expect(PAGE_SRC).not.toContain('rightSlotBar(slotLayout.right')
  })

  test('`rightSlotBar` itself survives for cli/shell alone, and still names the panel', () => {
    expect(PAGE_SRC).toContain("rightSlotBar('cli'")
    expect(PAGE_SRC).toContain("rightSlotBar('shell'")
    // The wrapper row now carries the panel's own name — see its own header for why.
    const fnAt = PAGE_SRC.indexOf('const rightSlotBar = (')
    expect(fnAt).toBeGreaterThan(-1)
    expect(PAGE_SRC.slice(fnAt, fnAt + 800)).toContain('{panelName}')
  })

  test('Hardware and the tab panel each receive the trio as a PROP instead', () => {
    expect(PAGE_SRC).toMatch(/<HardwarePanel[\s\S]*?controls=\{panelFixedControlsFor\(/)
    expect(PAGE_SRC).toContain('headerControls: panelFixedControlsFor(')
  })

  /** Plant: the pre-fix shape — a separate `rightSlotBar('hardware', ...)` row drawn above the
   *  panel, nothing passed to it as a prop. The second assertion above is what would fail. */
  test('the scan still catches the original bug if it comes back', () => {
    const reverted = stripComments([
      'rightIsHardware ? (',
      '  <div>',
      '    {rightSlotHeader}',
      "    {rightSlotBar('hardware', 'Hardware', () => closeSlotPanel('hardware'))}",
      '    {hardwarePaneEl}',
      '  </div>',
      ') : null',
    ].join('\n'))
    expect(reverted).toContain("rightSlotBar('hardware'")
  })
})

describe('HardwarePanel — no refresh button, and the close/trio share the one header row', () => {
  test('no manual refresh control — the 5s poll is what updates it (useHardwareSnapshot)', () => {
    expect(HARDWARE_SRC).not.toContain('RefreshCw')
    expect(HARDWARE_SRC).not.toMatch(/onClick=\{refresh\}/)
  })

  test('the close button is gated on `hideCloseButton`, never unconditional', () => {
    expect(HARDWARE_SRC).toContain('{!hideCloseButton && (')
  })

  test('`controls` renders in the SAME <header>, after the close button — one row, not two', () => {
    const headerAt = HARDWARE_SRC.indexOf('<header')
    const headerEnd = HARDWARE_SRC.indexOf('</header>')
    expect(headerAt).toBeGreaterThan(-1)
    expect(headerEnd).toBeGreaterThan(headerAt)
    const header = HARDWARE_SRC.slice(headerAt, headerEnd)
    expect(header).toContain('{!hideCloseButton && (')
    expect(header).toContain('{controls}')
    // The title truncates rather than pushing the trailing controls off the row.
    expect(header).toMatch(/minWidth:\s*0[\s\S]*?textOverflow:\s*'ellipsis'/)
  })

  /** Plant: the pre-fix shape — a manual refresh button, no `controls`/`hideCloseButton` props at
   *  all. `not.toContain('RefreshCw')` is what would fail against this string. */
  test('the scan still catches the original bug if it comes back', () => {
    const reverted = stripComments([
      "import { Cpu, RefreshCw, X } from 'lucide-react'",
      'function HardwarePanel({ lang, onClose }) {',
      '  return (',
      '    <header>',
      '      <button onClick={refresh}><RefreshCw /></button>',
      '      <button onClick={onClose}><X /></button>',
      '    </header>',
      '  )',
      '}',
    ].join('\n'))
    expect(reverted).toContain('RefreshCw')
  })
})

describe('ArtifactsAside — headerControls shares the title row, never a second strip above it', () => {
  test('the prop exists and is optional (absent draws nothing trailing)', () => {
    expect(ARTIFACTS_SRC).toContain('headerControls?: ReactNode')
  })

  test('rendered inside the SAME `header` variable as the title, after the close button', () => {
    const headerAt = ARTIFACTS_SRC.indexOf('const header = (')
    expect(headerAt).toBeGreaterThan(-1)
    const headerEnd = ARTIFACTS_SRC.indexOf('</header>', headerAt)
    expect(headerEnd).toBeGreaterThan(headerAt)
    const header = ARTIFACTS_SRC.slice(headerAt, headerEnd)
    expect(header).toContain('{panelTitle(activeTab, pt)}')
    expect(header).toContain('{!hideCloseButton && (')
    expect(header).toContain('{headerControls}')
    // headerControls is the LAST thing in the row — after the close button, not before it.
    expect(header.indexOf('{!hideCloseButton && (')).toBeLessThan(header.indexOf('{headerControls}'))
  })

  test('the title truncates rather than pushing the trailing controls off the row', () => {
    const headerAt = ARTIFACTS_SRC.indexOf('const header = (')
    const headerEnd = ARTIFACTS_SRC.indexOf('</header>', headerAt)
    const header = ARTIFACTS_SRC.slice(headerAt, headerEnd)
    const titleSpanAt = header.indexOf('{panelTitle(activeTab, pt)}')
    const titleSpanStart = header.lastIndexOf('<span', titleSpanAt)
    const titleSpanStyle = header.slice(titleSpanStart, titleSpanAt)
    expect(titleSpanStyle).toMatch(/minWidth:\s*0/)
    expect(titleSpanStyle).toMatch(/textOverflow:\s*'ellipsis'/)
    expect(titleSpanStyle).toMatch(/whiteSpace:\s*'nowrap'/)
  })

  /** Plant: `headerControls` never destructured/rendered at all — the pre-fix shape, where the
   *  trio could only ever arrive via a separate `rightSlotBar` row above this header. */
  test('the scan still catches the original bug if it comes back', () => {
    const reverted = stripComments([
      'export function ArtifactsAside({ activeTab, onClose, hideCloseButton }) {',
      '  const header = (',
      '    <header>',
      '      <span>{panelTitle(activeTab, pt)}</span>',
      '      {!hideCloseButton && (<button onClick={onClose} />)}',
      '    </header>',
      '  )',
      '}',
    ].join('\n'))
    expect(reverted).not.toContain('{headerControls}')
  })
})
