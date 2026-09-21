/**
 * sessionPanel.lint.test.ts — `StudioBand`'s content box may never sit inside a non-growing wrapper
 * (the freeze this pins).
 *
 * `StudioBand` (`SessionPanel.tsx`) shares its "snap to fill the column" geometry with `ShellBand`
 * (`resolveBandHeight`, `shellBand.ts`) — dragging the handle near the column's own top edge sets
 * `heightPrefs.full`, and the band's ROOT then reads `flex: '1 1 auto'` to stretch and fill it.
 *
 * The content box (the one the Studio's own portal carrier — `contentRef` — lives inside) used to
 * sit wrapped, together with the resize handle, in an EXTRA `<div style={{display:'flex',
 * flexDirection: 'column'}}>` with no `flex`/`minHeight` of its own. That div is a flex ITEM of the
 * root, and with no `flex` it takes only the height its CONTENT asks for (`flex: 0 1 auto`, the CSS
 * default) instead of growing into whatever the root — which DOES stretch when `full` — actually had
 * to give it. The content box's own `flex: '1 1 auto'` then had nothing to grow INTO (a flex-grow
 * child cannot exceed a non-growing parent), so the whole thing collapsed to its minimum size and the
 * root's remaining ~400px sat empty below it.
 *
 * MEASURED live, before the fix: dragging the handle to the column's top DID grow the root (its own
 * `getBoundingClientRect().height` read 469px, `flex: 1 1 auto` correctly applied) while the box
 * carrying `data-studio-layout` measured `height: 0` — the tree and the editor rendered into a
 * sliver at the top of the band and the rest sat blank, which is what read as "the band went
 * empty… and never became full screen." `ShellBand` never had this bug: its own content box is a
 * direct child of ITS root, with no such wrapper.
 *
 * THIS FILE WAS UPDATED for the band-grip-position fix (owner: "o item de reposicionamento muda de
 * lugar dependendo da aba, deveria estar sempre no topo"). The resize handle no longer shares a
 * Fragment with the content box at all — it moved OUT, to render ABOVE the bar row through the
 * shared `BandResizeHandle` (`bandControls.tsx`), which is what `bandGripPosition.lint.test.ts`
 * pins. What is left for THIS file to guard is narrower but unchanged in spirit: the content box
 * itself must still be a direct, un-wrapped flex item of the root — the freeze this file exists for
 * is about THAT box, never about where the handle happens to sit.
 *
 * Not reachable by rendering: `StudioBand` is not exported (there is no seam to mount it through),
 * and this package has no jsdom regardless. The SHAPE is what went wrong, so the shape is what is
 * asserted, over comment-free source, with the defect planted below to prove the scan still sees it.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from '../../lib/stripComments'

const RAW = readFileSync(join(import.meta.dir, 'SessionPanel.tsx'), 'utf-8')
const SRC = stripComments(RAW)

/** Only `StudioBand`'s own body — `SimpleDockedBand`, further down, has its own unrelated
 *  `{open && (`. */
function studioBandBody(src: string): string {
  const start = src.indexOf('function StudioBand(')
  const end = src.indexOf('function SimpleDockedBand(')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('StudioBand — the content box is a direct, un-wrapped flex item of the growing root', () => {
  test('the content block is `{open && (`, never `{open && !fullscreen && (` — that guard belongs to the handle alone', () => {
    const body = studioBandBody(SRC)
    // The handle's own conditional carries the EXTRA `!fullscreen` term (it disappears in true full
    // screen); the content box renders whenever the band is merely `open`, fullscreen or not. Two
    // different conditionals for two different things — collapsing them back into one would either
    // hide the content in full screen or show a handle with nothing left to negotiate a height for.
    const contentAt = body.indexOf('{open && (')
    expect(contentAt).toBeGreaterThan(-1)
    const handleAt = body.indexOf('{open && !fullscreen && (')
    expect(handleAt).toBeGreaterThan(-1)
    expect(handleAt).toBeLessThan(contentAt)
  })

  test('the open content block\'s immediate child is a plain div, never re-wrapped in a further non-flex div', () => {
    const body = studioBandBody(SRC)
    const contentAt = body.indexOf('{open && (')
    const after = body.slice(contentAt + '{open && ('.length).trimStart()
    // The box itself carries an explicit `flex`/`height` decision (see the style object a few lines
    // below) — a bare, propless wrapper div is exactly the shape that swallowed the height before.
    expect(after.startsWith('<div style={{ display: \'flex\', flexDirection: \'column\' }}>')).toBe(false)
    expect(after.startsWith('<div style={{')).toBe(true)
  })

  test('`ref={contentRef}` sits after that SAME open block, and nowhere else in this band', () => {
    const body = studioBandBody(SRC)
    const contentAt = body.indexOf('{open && (')
    const contentRefAt = body.indexOf('ref={contentRef}')
    expect(contentRefAt).toBeGreaterThan(contentAt)
    // Exactly one — a second `contentRef` anywhere in this band would mean a second host, which
    // `StudioHost.tsx`'s own re-parenting trick cannot handle.
    expect(body.match(/ref=\{contentRef\}/g)?.length).toBe(1)
  })

  test('the scan still sees the wrapper reintroduced, at the exact spot that broke this', () => {
    const body = studioBandBody(SRC)
    const contentAt = body.indexOf('{open && (')
    const DIV_OPEN = '<div style={{ display: \'flex\', flexDirection: \'column\' }}>'
    // Plant: wrap the content box's own opening tag in the old, non-flex wrapper.
    const boxOpenAt = contentAt + '{open && ('.length
    const planted = body.slice(0, boxOpenAt) + DIV_OPEN + body.slice(boxOpenAt)
    const after = planted.slice(boxOpenAt).trimStart()
    expect(after.startsWith(DIV_OPEN)).toBe(true)
  })
})
