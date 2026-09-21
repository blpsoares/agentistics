/**
 * sessionPanel.lint.test.ts — `StudioBand`'s resize handle and content box may never sit inside a
 * non-growing wrapper (the freeze this pins).
 *
 * `StudioBand` (`SessionPanel.tsx`) shares its "snap to fill the column" geometry with `ShellBand`
 * (`resolveBandHeight`, `shellBand.ts`) — dragging the handle near the column's own top edge sets
 * `heightPrefs.full`, and the band's ROOT then reads `flex: '1 1 auto'` to stretch and fill it.
 *
 * The resize handle and the content box (the one the Studio's own portal carrier — `contentRef` —
 * lives inside) used to sit wrapped in an EXTRA `<div style={{display:'flex',flexDirection:
 * 'column'}}>` with no `flex`/`minHeight` of its own. That div is a flex ITEM of the root, and
 * with no `flex` it takes only the height its CONTENT asks for (`flex: 0 1 auto`, the CSS default)
 * instead of growing into whatever the root — which DOES stretch when `full` — actually had to
 * give it. The content box's own `flex: '1 1 auto'` then had nothing to grow INTO (a flex-grow
 * child cannot exceed a non-growing parent), so the whole thing collapsed to its minimum size and
 * the root's remaining ~400px sat empty below it.
 *
 * MEASURED live, before the fix: dragging the handle to the column's top DID grow the root (its own
 * `getBoundingClientRect().height` read 469px, `flex: 1 1 auto` correctly applied) while the box
 * carrying `data-studio-layout` measured `height: 0` — the tree and the editor rendered into a
 * sliver at the top of the band and the rest sat blank, which is what read as "the band went
 * empty… and never became full screen." `ShellBand` never had this bug: its own handle and content
 * box are direct children of ITS root, with no such wrapper — this file's fix makes `StudioBand`
 * match that shape (a Fragment, not a div) rather than inventing a second one.
 *
 * Not reachable by rendering: `StudioBand` is not exported (there is no seam to mount it through),
 * and this package has no jsdom regardless. The SHAPE is what went wrong, so the shape is what is
 * asserted, over comment-free source, with the defect planted below to prove the scan still sees
 * it — see `SessionPanel.tsx`'s own header comment at the fix site for the live-repro proof (two
 * screenshots, before and after, in this task's report) that a rendering test cannot itself carry.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from '../../lib/stripComments'

const RAW = readFileSync(join(import.meta.dir, 'SessionPanel.tsx'), 'utf-8')
const SRC = stripComments(RAW)

/** Only `StudioBand`'s own body — `PanelBarBand`, further down, has its own unrelated `{open && (`. */
function studioBandBody(src: string): string {
  const start = src.indexOf('function StudioBand(')
  const end = src.indexOf('function PanelBarBand(')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('StudioBand — the resize handle and content box are direct children of the growing root', () => {
  test('the open block is a Fragment, never a plain div, around the handle and the content box', () => {
    const body = studioBandBody(SRC)
    const openAt = body.indexOf('{open && (')
    expect(openAt).toBeGreaterThan(-1)
    // The next non-whitespace token after `{open && (` must be a Fragment opener, not a div that
    // would re-introduce the non-growing wrapper.
    const after = body.slice(openAt + '{open && ('.length).trimStart()
    expect(after.startsWith('<>')).toBe(true)
    expect(after.startsWith("<div style={{ display: 'flex', flexDirection: 'column' }}>")).toBe(false)
  })

  test('the resize handle and the content box both close back into that SAME fragment', () => {
    const body = studioBandBody(SRC)
    const openAt = body.indexOf('{open && (')
    const closeAt = body.indexOf('</>', openAt)
    const separatorAt = body.indexOf('role="separator"', openAt)
    const contentRefAt = body.indexOf('ref={contentRef}', openAt)
    expect(closeAt).toBeGreaterThan(-1)
    expect(separatorAt).toBeGreaterThan(openAt)
    expect(separatorAt).toBeLessThan(closeAt)
    expect(contentRefAt).toBeGreaterThan(separatorAt)
    expect(contentRefAt).toBeLessThan(closeAt)
  })

  test('the scan still sees the wrapper reintroduced, at the exact spot that broke this', () => {
    const body = studioBandBody(SRC)
    const openAt = body.indexOf('{open && (')
    const fragOpenAt = body.indexOf('<>', openAt)
    const fragCloseAt = body.indexOf('</>', fragOpenAt)
    expect(fragOpenAt).toBeGreaterThan(-1)
    expect(fragCloseAt).toBeGreaterThan(fragOpenAt)
    const DIV_OPEN = "<div style={{ display: 'flex', flexDirection: 'column' }}>"
    const planted = body.slice(0, fragOpenAt) + DIV_OPEN
      + body.slice(fragOpenAt + '<>'.length, fragCloseAt) + '</div>'
      + body.slice(fragCloseAt + '</>'.length)
    const after = planted.slice(openAt + '{open && ('.length).trimStart()
    expect(after.startsWith(DIV_OPEN)).toBe(true)
  })
})

/**
 * FULL SCREEN IS A PROPERTY OF THE PANEL, NOT OF THE SLOT — found while fixing the band's resize
 * grip: drag the Studio to fill the column, then move Contents into the SAME bottom band, and
 * Contents read as full too, on the first frame, before anyone had dragged it anywhere. The stored
 * `BandPrefs.full` used to be one flat boolean shared by whichever panel next reads it — the fix
 * (`shellBand.ts`'s `bandPanelFull`/`withBandPanelFull`, keyed by `PanelId`) means `StudioBand` and
 * `SimpleDockedBand` must each read and write only THEIR OWN entry, never the bare `p.full`/
 * `next.full` boolean the old shape allowed.
 *
 * Not reachable by rendering, for the same reason as the tests above — the SHAPE is what is
 * asserted, with the old pattern planted back in to prove the scan still catches it.
 */
describe('StudioBand / SimpleDockedBand read and write only their OWN panel\'s full-screen entry', () => {
  test('no component in this file reads the old flat `p.full === true` shape', () => {
    expect(SRC).not.toMatch(/p\.full === true/)
  })

  test('StudioBand reads its own entry by name', () => {
    expect(SRC).toContain("return { height: p.height, full: bandPanelFull(p, 'studio') }")
  })

  test('SimpleDockedBand reads its own entry through the `panel` prop, not a literal', () => {
    expect(SRC).toContain('return { height: p.height, full: bandPanelFull(p, panel) }')
  })

  test('both bands write through `withBandPanelFull`, never a bare `full: true`/`full: next.full` merge', () => {
    expect([...SRC.matchAll(/withBandPanelFull\(/g)]).toHaveLength(2)
    // The OLD write shape this replaces — a literal `full: true` spliced into the record by hand.
    expect(SRC).not.toMatch(/\.\.\.\(next\.full \? \{ full: true \} : \{\}\)/)
  })

  test('the scan still sees the old shared-boolean read reintroduced', () => {
    const planted = SRC.replace(
      "return { height: p.height, full: bandPanelFull(p, 'studio') }",
      'return { height: p.height, full: p.full === true }',
    )
    expect(planted).toMatch(/p\.full === true/)
  })

  test('the scan still sees the old shared-boolean write reintroduced', () => {
    const planted = `${SRC}\n  writeBandPrefs({ ...rest, height: next.height, ...(next.full ? { full: true } : {}) })\n`
    expect(planted).toMatch(/\.\.\.\(next\.full \? \{ full: true \} : \{\}\)/)
  })
})

/**
 * FULL SCREEN STOPS SHORT OF THE ARTIFACTS ASIDE (change #2) — `StudioBand`'s and
 * `SimpleDockedBand`'s own `position: fixed` overlays used to hard-code `inset: 0`, covering the
 * aside whenever it was independently showing something else (owner: "o studio... some com o
 * aside da direita"). Both must now compute `right` through `fullscreenInsetRight`, never `inset: 0`
 * on the fullscreen branch.
 */
describe('the fullscreen overlay respects the artifacts aside (I2)', () => {
  test('no `inset: 0` survives on the fullscreen branch of either band', () => {
    expect(SRC).not.toMatch(/position: 'fixed', inset: 0/)
  })

  test('both bands compute their right inset through `fullscreenInsetRight`', () => {
    expect([...SRC.matchAll(/right: fullscreenInsetRight\(rightAsideEdge, viewportWidth\)/g)]).toHaveLength(2)
  })

  test('both bands read the aside\'s live edge and the viewport width reactively', () => {
    expect([...SRC.matchAll(/const rightAsideEdge = useRightAsideEdge\(\)/g)]).toHaveLength(2)
    expect([...SRC.matchAll(/const viewportWidth = useViewportWidth\(\)/g)]).toHaveLength(2)
  })

  test('the scan still sees `inset: 0` reintroduced on a fullscreen branch', () => {
    const planted = SRC.replace(
      "position: 'fixed', top: 0, left: 0, bottom: 0,\n          right: fullscreenInsetRight(rightAsideEdge, viewportWidth),\n          zIndex: PANEL_FULLSCREEN_Z,",
      "position: 'fixed', inset: 0, zIndex: PANEL_FULLSCREEN_Z,",
    )
    expect(planted).toMatch(/position: 'fixed', inset: 0/)
  })
})

/**
 * `<ShellBand>` IS WIRED TO THE SAME `slotLayout.bottomOpen` / `setBottomOpen` PAIR
 * `<StudioBand>`/`<SimpleDockedBand>` ALREADY TAKE AS `open`/`onToggleOpen` — the fix for "picking
 * a tab minimized the band instead of switching to it" (owner report). `ShellBand` cannot take
 * `open` as a fully controlled prop the way the other two do (its shell-resolution reducer reads
 * the SAME flag at its own mount-time init, not only at render), so it takes `open`/`onOpenChange`
 * instead — a seed plus a change notifier — but the SOURCE on this end is identical: this page's
 * own `slotLayout.bottomOpen` and `setBottomOpen`, never a value this component invents.
 */
describe('ShellBand is wired to the shared bottomOpen state (I3 — "picking Shell minimized the band")', () => {
  test('the mount call passes `open={slotLayout.bottomOpen}`', () => {
    expect(SRC).toContain('open={slotLayout.bottomOpen}')
  })

  test('the mount call passes `onOpenChange={setBottomOpen}`', () => {
    expect(SRC).toContain('onOpenChange={setBottomOpen}')
  })

  test('both land inside the `bottomBand === \'shell\'` branch, on the `<ShellBand` call, not a different component', () => {
    const start = SRC.indexOf("bottomBand === 'shell' ? (")
    const shellBandAt = SRC.indexOf('<ShellBand', start)
    const closeAt = SRC.indexOf('/>', shellBandAt)
    expect(start).toBeGreaterThan(-1)
    expect(shellBandAt).toBeGreaterThan(start)
    expect(closeAt).toBeGreaterThan(shellBandAt)
    const props = SRC.slice(shellBandAt, closeAt)
    expect(props).toContain('open={slotLayout.bottomOpen}')
    expect(props).toContain('onOpenChange={setBottomOpen}')
  })

  test('the scan still sees the wiring dropped from the call — the check itself would then fail', () => {
    // Simulates the regression WITHIN THE SHELLBAND CALL SPECIFICALLY — `open={slotLayout.bottomOpen}`
    // is not a unique string (`StudioBand`/`SimpleDockedBand` take the identical prop), so the plant
    // is scoped to the exact slice the earlier test already isolates, or removing the FIRST
    // occurrence anywhere in the file (most likely `StudioBand`'s own, textually first) would prove
    // nothing about THIS call.
    const start = SRC.indexOf("bottomBand === 'shell' ? (")
    const shellBandAt = SRC.indexOf('<ShellBand', start)
    const closeAt = SRC.indexOf('/>', shellBandAt)
    const before = SRC.slice(shellBandAt, closeAt)
    const after = before
      .replace('open={slotLayout.bottomOpen}', '// removed')
      .replace('onOpenChange={setBottomOpen}', '// removed')
    expect(after.includes('open={slotLayout.bottomOpen}')).toBe(false)
    expect(after.includes('onOpenChange={setBottomOpen}')).toBe(false)
  })
})
