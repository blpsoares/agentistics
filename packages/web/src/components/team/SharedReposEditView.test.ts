import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COPY, interpolate } from './copy'
import { relTime } from './cardState'
import { rowDivider, pickerListStyle } from './SharedReposEditView'

describe('SharedReposEditView — locked no-repository row subtitle', () => {
  test('has a dedicated copy entry for locked no-repo rows that does not end in an empty name', () => {
    // A locked "No repository" row should display an appropriate subtitle.
    // It must not be a template with an empty {repo} placeholder, and should not be
    // the generic mixedRepoWarn which describes multi-repo folders.
    expect(COPY).toHaveProperty('lockedNoRepoWarn')

    const lockedNoRepoSubtitle = COPY.lockedNoRepoWarn
    expect(lockedNoRepoSubtitle.en.length).toBeGreaterThan(0)
    expect(lockedNoRepoSubtitle.pt.length).toBeGreaterThan(0)

    // Should not contain templates that interpolate repo/repoKey values
    expect(lockedNoRepoSubtitle.en).not.toContain('{repo}')
    expect(lockedNoRepoSubtitle.pt).not.toContain('{repo}')

    // Should not end with an empty string or placeholder
    expect(lockedNoRepoSubtitle.en.trim()).not.toMatch(/:\s*$|"\s*$/)
    expect(lockedNoRepoSubtitle.pt.trim()).not.toMatch(/:\s*$|"\s*$/)
  })
})

// --- the picker's row chrome ---------------------------------------------------------------------

describe('SharedReposEditView — row chrome', () => {
  const src = readFileSync(join(import.meta.dir, 'SharedReposEditView.tsx'), 'utf8')

  test('the repositories tab does not repeat the host — the tab already says these are repos', () => {
    // `ShareTarget.name` is already `repoShortName(key)` (org/repo). A `github.com` pill beside it
    // is the tab's own context spelled out again, and it sat inches from the withheld warning so
    // the two read as the same kind of object.
    expect(src).not.toContain('}}>{t.host}</span>')
    // The full `host/org/repo` must stay REACHABLE — dropping the host from the pill may not drop
    // it from the row's identity, or two hosts carrying the same org/repo become indistinguishable.
    expect(src).toContain('title={rowTitle(t)}')
  })

  test('rows are visibly divided from one another', () => {
    // Each row is a name plus a sessions/last-active line plus possibly a warning; with nothing
    // between them the eye cannot find the boundary.
    expect(src).toContain('rowDivider(')
  })
})

describe('rowDivider', () => {
  test('draws a hairline between rows and never after the last one', () => {
    expect(rowDivider(0, 3).borderTop).toBeUndefined()
    expect(rowDivider(1, 3).borderTop).toBe('1px solid var(--border-subtle)')
    expect(rowDivider(2, 3).borderTop).toBe('1px solid var(--border-subtle)')
    // A single-row group needs no rule at all.
    expect(rowDivider(0, 1).borderTop).toBeUndefined()
    // It must stay a hairline, not a heavy rule competing with the group headings.
    expect(rowDivider(1, 2).borderTop).not.toContain('2px')
  })
})

describe('the PT "last active" line', () => {
  test('says the preposition once, not twice', () => {
    // relTime already returns "há 1d" in PT, so a template of "ativo há {t}" rendered "ativo há há 1d".
    // Asserted on the RENDERED string, never the template — that is what the user reads.
    const rendered = interpolate(COPY.lastActiveT.pt, { t: relTime(Date.now() - 26 * 3600_000, true) })
    expect(rendered).toBe('ativo há 1d')
    expect(rendered).not.toContain('há há')
  })

  test('every {t} row survives its own PT relative time without doubling a preposition', () => {
    const t = relTime(Date.now() - 26 * 3600_000, true)
    expect(t).toBe('há 1d')
    const rows = [COPY.lastActiveT, COPY.lastSync] as const
    let checked = 0
    for (const row of rows) {
      expect(interpolate(row.pt, { t })).not.toContain('há há')
      // EN has no preposition of its own ("1d ago" carries it), so it must not gain one.
      expect(interpolate(row.en, { t: relTime(Date.now() - 26 * 3600_000, false) })).not.toContain('ago ago')
      checked++
    }
    expect(checked).toBe(rows.length)
    expect(checked).toBe(2)
  })
})

// --- the list must scroll in its own region, not be cut at an arbitrary height -------------------

describe('pickerListStyle', () => {
  test('never caps the list at a fixed pixel height', () => {
    // The bug: `maxHeight: 360` inside a drawer panel that is `height: 100%`. The list stopped at
    // 360px regardless of how tall the drawer actually was, cutting a row through the middle of
    // its text and leaving the space BELOW the cut empty — so it read as the end of the list.
    const desktop = pickerListStyle(false)
    expect(desktop.maxHeight).not.toBe(360)
    expect(String(desktop.maxHeight)).not.toContain('360')
    // It has to be relative to the space available, not a constant.
    expect(String(desktop.maxHeight)).toContain('vh')
  })

  test('the region scrolls, can shrink inside a flex parent, and shows that it scrolls', () => {
    const desktop = pickerListStyle(false)
    expect(desktop.overflowY).toBe('auto')
    // Without `minHeight: 0` a flex child refuses to shrink below its content and overflows the
    // drawer instead of scrolling inside it.
    expect(desktop.minHeight).toBe(0)
    // A reserved gutter is what stops a partially visible row reading as a clipped last row.
    expect(desktop.scrollbarGutter).toBe('stable')
  })

  test('a phone is not given a second scroll box inside the page', () => {
    // Mobile already caps the rows (MOBILE_ROW_CAP + "show all"); a nested scroller on top of that
    // is a box you cannot scroll with a thumb that is already scrolling the drawer.
    const mobile = pickerListStyle(true)
    expect(mobile.maxHeight).toBeUndefined()
    expect(mobile.overflowY).toBeUndefined()
  })
})

describe('the drawer that hosts the picker', () => {
  const src = readFileSync(join(import.meta.dir, '../../pages/settings/Drawer.tsx'), 'utf8')

  test('the panel does not scroll — its BODY does, so the chrome stays put', () => {
    // Two nested scrollers (panel + list) with the inner one fixed at 360px is what left dead
    // space under the cut. The panel is the frame; only the body moves.
    expect(src).not.toContain("overflowY: 'auto',\n          }}")
    expect(src).toContain("overflow: 'hidden'")
    expect(src).toContain("minHeight: 0")
    // Header and footer must not be squeezed by a long body.
    expect(src.match(/flexShrink: 0/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
