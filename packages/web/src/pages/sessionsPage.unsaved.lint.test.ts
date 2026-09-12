/**
 * THE PAGE THAT DROPS THE STUDIO ASKS BEFORE IT DOES — asserted at the level that broke.
 *
 * `ArtifactsAside.gate.lint.test.ts` pins that nothing INSIDE the panel can unmount the Studio, and
 * that is exactly why the loss one level out went unnoticed: `SessionsPage` unmounts the whole pane
 * (`artShell === 'none'`) when the panel closes and when the page navigates away, and with autosave
 * off by default that dropped every unsaved buffer with no prompt. The pure halves are tested in
 * `lib/unsavedBuffers.test.ts`, `lib/unsavedLeave.test.ts` and `lib/artifactsStore.test.ts`; what
 * only the source can show is the WIRING that connects them to this page and to the Studio — and
 * each link, if dropped, silently turns the whole guard off while every one of those tests stays
 * green.
 *
 * Comments are stripped first with the one shared `stripComments`: these files explain the guard
 * in prose, and a doc comment naming `{leaveGuard}` must not satisfy an assertion that it is
 * rendered. Every scan has a self-check planting the defect.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { stripComments } from '../lib/stripComments'

const WEB_SRC = join(import.meta.dir, '..')
const PAGE = stripComments(readFileSync(join(import.meta.dir, 'SessionsPage.tsx'), 'utf8'))
const STUDIO = stripComments(readFileSync(join(WEB_SRC, 'components/sessions/Studio.tsx'), 'utf8'))
const STORE = stripComments(readFileSync(join(WEB_SRC, 'lib/artifactsStore.ts'), 'utf8'))

/** The return that renders the pane: from its root's `ref={splitRef}` to the end of the file. */
function paneReturn(src: string): string {
  const at = src.indexOf('ref={splitRef}')
  return at === -1 ? '' : src.slice(at)
}

/** The pane slot and the guard slot, both inside that one return. */
function guardBesidePane(src: string): boolean {
  const ret = paneReturn(src)
  return ret.includes("{artShell === 'none' ? null : (") && /\{leaveGuard\}/.test(ret)
}

function guardDefined(src: string): boolean {
  return /const leaveGuard = \(\s*<UnsavedChangesGuard\b[\s\S]{0,200}?sessionKeys=\{/.test(src)
}

describe('SessionsPage holds the pane drop behind the question', () => {
  test('the guard is defined with the session keys, and rendered in the return that holds the pane', () => {
    expect(PAGE.includes("import { UnsavedChangesGuard } from '../components/sessions/UnsavedChangesGuard'")).toBe(true)
    expect(guardDefined(PAGE)).toBe(true)
    expect(guardBesidePane(PAGE)).toBe(true)
  })

  test('the pane is closed through the store close that asks, not a bypass', () => {
    const aside = PAGE.slice(PAGE.indexOf('<ArtifactsAside'), PAGE.indexOf('const leaveGuard'))
    expect(aside.includes('onClose={closeArtifacts}')).toBe(true)
  })

  test('the scan still sees the defect it exists to catch', () => {
    // The shape that shipped: the pane slot with no guard beside it.
    const unguarded = PAGE.replace(/\{leaveGuard\}/g, '')
    expect(guardBesidePane(unguarded)).toBe(false)
    // The guard rendered in some OTHER return, not the one holding the pane.
    const elsewhere = `return (<div>{leaveGuard}</div>)\n${unguarded}`
    expect(guardBesidePane(elsewhere)).toBe(false)
    // And the comment form: prose naming the slot is not the slot.
    expect(guardBesidePane(stripComments(`ref={splitRef} {artShell === 'none' ? null : (x)} /* {leaveGuard} */`)))
      .toBe(false)
    expect(guardBesidePane(`ref={splitRef} {artShell === 'none' ? null : (x)} {leaveGuard}`)).toBe(true)
  })
})

describe('the links the guard depends on', () => {
  test('the one close function asks before it closes', () => {
    expect(/export function closeArtifacts\(\): void \{\s*if \(state\.open && holdIfUnsaved\('close', closeNow\)\) return\s*closeNow\(\)\s*\}/
      .test(STORE)).toBe(true)
  })

  test('the Studio REPORTS its dirty paths, and clears them when it unmounts', () => {
    expect(/reportUnsaved\(unsavedOwner, /.test(STUDIO)).toBe(true)
    expect(STUDIO.includes('useEffect(() => () => clearUnsaved(unsavedOwner), [unsavedOwner])')).toBe(true)
    // Derived from the tabs' own dirty flag, the one `ConfirmModal` for a single tab already reads.
    expect(STUDIO.includes("const dirtyKey = tabs.filter(t => t.dirty).map(t => t.path)")).toBe(true)
  })

  test('nothing else in the web package closes the panel around the question or answers it', () => {
    // `closeNow` is module-private to the store, and `answerUnsaved` is spoken only by the modal.
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue
        const src = stripComments(readFileSync(p, 'utf8'))
        const rel = relative(WEB_SRC, p)
        if (/\banswerUnsaved\(/.test(src) && rel !== join('components', 'sessions', 'UnsavedChangesGuard.tsx')
          && rel !== join('lib', 'unsavedBuffers.ts')) offenders.push(rel)
        if (/\bcloseNow\b/.test(src) && rel !== join('lib', 'artifactsStore.ts')) offenders.push(rel)
      }
    }
    walk(WEB_SRC)
    expect(offenders).toEqual([])
    expect(/export function closeNow/.test(STORE)).toBe(false)
  })

  test('the scan still sees a close that skips the question, and a Studio that stopped reporting', () => {
    const bypass = STORE.replace("if (state.open && holdIfUnsaved('close', closeNow)) return", '')
    expect(/export function closeArtifacts\(\): void \{\s*if \(state\.open && holdIfUnsaved\('close', closeNow\)\) return/
      .test(bypass)).toBe(false)
    expect(/reportUnsaved\(unsavedOwner, /.test(stripComments('// reportUnsaved(unsavedOwner, paths)'))).toBe(false)
  })
})
