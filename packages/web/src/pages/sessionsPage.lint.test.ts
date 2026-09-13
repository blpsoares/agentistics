/**
 * sessionsPage.lint.test.ts — the centre's root may not change SHAPE with the edge strip.
 *
 * `SessionsPage` returned `edgeMarker === null ? panel : <div>{edgeMarker}{panel}</div>`. React
 * reconciles by POSITION, so swapping the root between `panel` and a div CONTAINING it unmounts the
 * whole panel and mounts a new one — every DOM node recreated, the composer's textarea among them.
 * Typing while a session worked lost the caret the moment the strip appeared, and lost it AGAIN
 * when it went away.
 *
 * A unit test cannot see this without mounting the page against a fleet host, which nothing in
 * `packages/web` is set up to do. The shape is what went wrong, so the shape is what is asserted —
 * the same approach `tokens.lint.test.ts` and `backup-route-body.lint.test.ts` take to invariants
 * that live in source rather than in a value.
 */
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from '../lib/stripComments'

const RAW = readFileSync(join(import.meta.dir, 'SessionsPage.tsx'), 'utf-8')

/**
 * CODE ONLY — comments are stripped before anything is asserted, BLOCK COMMENTS INCLUDED.
 *
 * The file explains the bug it forbids, quoting the old expression verbatim, so a grep over the raw
 * text matches the explanation and fails on a file that is correct. Same trap `attention-rules.ts`
 * records for footer markers: a source that discusses a pattern contains that pattern.
 *
 * **The stripper is `lib/stripComments.ts`, and it is shared on purpose.** This file used to keep
 * its own, which dropped only lines whose trim STARTS with `//` — so a needle planted as a TRAILING
 * comment after real code survived it, and a reviewer proved exactly that against the positive
 * assertion that used to live below. Two strippers of different strength for one job is one
 * stripper and one hole.
 */
const SRC = stripComments(RAW)

test('the centre is not swapped between `panel` and a wrapper around it', () => {
  // Any ternary whose branches are "the panel" and "something containing the panel" is this bug.
  expect(SRC).not.toMatch(/\?\s*panel\s*:/)
  expect(SRC).not.toMatch(/:\s*panel\s*\}/)
})

test('the edge strip is rendered INSIDE the wrapper, not as an alternative to it', () => {
  // The wrapper holds both, in this order, unconditionally — a `null` in the slot when the strip is
  // absent, which is what makes both cases the same shape. It is a fragment rather than a `return`
  // since the centre became a VALUE (see the `artifactsPane` assertions below); the property being
  // pinned is unchanged, and it is the ORDER plus the unconditional slot.
  const wrapper = /\{artShell === 'none' \? edgeMarker : null\}\s*\{panel\}/
  expect(SRC).toMatch(wrapper)
})

/**
 * ONE PANE, ONE PLACE — the defect this page shipped and the reason the centre is a value.
 *
 * `artifactsPane` was written into FOUR separate `return`s, one per `ArtifactLayout`. React
 * reconciles by POSITION, so four positions are four different elements: crossing 768px or
 * `SPLIT_MIN` unmounted the entire aside and mounted a new one. The Studio's whole composition
 * (`Layer`, `mountedEditors`, `StudioBody`'s one DOM shape) exists so that an unsaved buffer
 * survives every move a reader makes inside it, and the page around it was discarding the lot
 * whenever the WINDOW changed size — which on a phone is turning it over, or opening the keyboard.
 *
 * MEASURED at 390x844 on a live session before the fix: two files open, the second edited and the
 * strip reading `artifactLayout.test.ts — não salvo`, one Monaco instance. After a single resize to
 * 1600x900 the same reads answered `openTabs: []`, `monaco: 0` and a re-fetched tree.
 *
 * This is the same class of invariant as the edge-strip shape above, and the same reason it is a
 * grep: seeing it requires mounting the page against a fleet host and resizing the window, and
 * `packages/web` has no jsdom. The COUNT is what went wrong, so the count is what is asserted.
 */
test('the artifacts pane is rendered in exactly ONE place', () => {
  expect([...SRC.matchAll(/\{artifactsPane\}/g)]).toHaveLength(1)
})

test('...and the layout is a STYLE, not a second copy of the pane', () => {
  // The one slot, and the two style objects the four old branches collapsed into. `artShell` is the
  // single answer to "which shape"; a branch that returned early would not need it.
  expect(has('const artShell:')).toBe(true)
  expect(has('const artOuter: CSSProperties')).toBe(true)
  expect(has('<div style={artOuter}>')).toBe(true)
  expect(has('<div style={artInner}>{artifactsPane}</div>')).toBe(true)
  // And the centre is a value. A `return` inside the layout branches is how the four sites happened.
  expect(has('let centre: ReactNode')).toBe(true)
})

test('the scan still sees a SECOND pane being added back', () => {
  // The plant: the same needle twice is what a second render site looks like, and the scan must
  // count it — including when one of the two is only prose, which must NOT count.
  const twice = 'a{artifactsPane}b\nc{artifactsPane}d\n'
  expect([...stripComments(twice).matchAll(/\{artifactsPane\}/g)]).toHaveLength(2)
  expect([...stripComments('{artifactsPane}\n// {artifactsPane}\n').matchAll(/\{artifactsPane\}/g)])
    .toHaveLength(1)
  expect([...stripComments('{artifactsPane}\nconst x = 1 // {artifactsPane}\n').matchAll(/\{artifactsPane\}/g)])
    .toHaveLength(1)
  expect([...stripComments('{artifactsPane}\n/* {artifactsPane} */\n').matchAll(/\{artifactsPane\}/g)])
    .toHaveLength(1)
})

// Without this the greps above could pass on a file that no longer has either name, which would be
// a test that checks nothing while staying green.
test('the names this pins still exist in the file', () => {
  expect(SRC).toContain('const edgeMarker')
  expect(SRC).toContain('const panel =')
})

/**
 * THE STUDIO'S GATE IS READ HERE AND NARROWED NOWHERE.
 *
 * `/api/fleet` is refused WHOLE on a central, and `editor-gate.ts` carries no central term — so a
 * central on a `local` profile with the preference on reports `editorEnabled: true`. That term used
 * to be subtracted on this line, which was correct for the two entries this page owns and said
 * nothing about the next surface to read `ctx.editorEnabled`. It is now subtracted where the value
 * is PUBLISHED (`lib/editorGate.ts`, spent in `App.tsx`'s `appCtx`), and the property — a central
 * never publishes a true `editorEnabled` — is asserted app-wide in `lib/editorGate.test.ts`.
 *
 * What is left for THIS page is narrower and still worth pinning: it reads the published value ONCE
 * and adds nothing to it. A second reading is a second gate, which is how the mobile entry came to
 * disagree with the desktop one in the first place.
 *
 * Not reachable by rendering: the page needs a fleet host and `packages/web` has no jsdom. The
 * expression is what went wrong, so the expression is what is asserted — over comment-free source,
 * with the defect planted below to prove the scan can still see it.
 */
const GATE = 'const editorEnabled = ctx.editorEnabled === true'

/**
 * A needle, as a BOOLEAN — the lesson `ArtifactsAside.gate.lint.test.ts` records.
 *
 * `expect(SRC).toMatch(…)` on a 60 KB file prints the whole file on failure, which buries the one
 * line that says what broke. The needle is in the assertion's own line; what the report has to carry
 * is whether it is there.
 */
const has = (needle: string) => SRC.includes(needle)

test('the Studio gate is the published value, read as written', () => {
  expect(has(GATE)).toBe(true)
})

test('and it is the only reading of `ctx.editorEnabled` on this page', () => {
  // A second, ungated read would be a second gate — which is exactly how the mobile entry came to
  // disagree with the desktop one.
  expect([...SRC.matchAll(/ctx\.editorEnabled/g)]).toHaveLength(1)
})

test('both Studio entries on this page are gated on that one value', () => {
  // The mobile session-menu row, and the prop the aside's strip entry and layer mount read.
  expect(/\.\.\.\(editorEnabled \? \[\{\s*\n\s*id: 'studio',/.test(SRC)).toBe(true)
  expect(has('editorEnabled={editorEnabled}')).toBe(true)
})

test('the scan still sees the defect it exists to catch', () => {
  // The line gone, and then each of the three ways it can be present as PROSE rather than as code.
  const gone = 'const editorEnabled = somethingElse\n'
  expect(stripComments(gone).includes(GATE)).toBe(false)
  expect(stripComments(`/**\n * ${GATE}\n */\n${gone}`).includes(GATE)).toBe(false)
  expect(stripComments(`// ${GATE}\n${gone}`).includes(GATE)).toBe(false)
  // THE PLANT THIS FILE SHIPPED WITHOUT. A needle written after real code is not code, and the
  // stripper that used to live here — lines whose trim STARTS with `//` — let exactly this through;
  // a reviewer proved it, and only a sibling assertion noticed.
  expect(stripComments(`const x = 1 // ${GATE}\n${gone}`).includes(GATE)).toBe(false)
})

/**
 * THE TWO "WHY THE COUNT IS SHORT" FACTS REACH A SURFACE.
 *
 * `hasUnlistedWrites` was computed on every poll and read by nothing for a release: its two surfaces
 * went with the Files tab and the producer stayed. A computed-and-discarded honesty flag is the worst
 * of the three options — it looks like the fact is being reported. The route's `outside` sentence was
 * dropped outright on a misreading of its own words (it qualifies OPENING, not listing).
 *
 * Both are now carried to the aside's header, beside the count they qualify. Asserted here because
 * `noUnusedLocals` is `false` in this package, so nothing else would notice either going dead again.
 */
test('the unlistable-writes flag is stored and handed to the aside', () => {
  expect(has('setArtifactsUnlisted(a.unlisted)')).toBe(true)
  expect(has('unlistedWrites={artifactsUnlisted}')).toBe(true)
})

test('the route\'s `outside` sentence is read and handed to the aside', () => {
  expect(has('setOutsideNote(d.outside)')).toBe(true)
  expect(has('{...(outsideNote ? { outsideNote } : {})}')).toBe(true)
})

test('the scan still sees either of those going dead', () => {
  // A prop passed in a comment is not a prop passed — in any of the three comment shapes.
  expect(stripComments('/* unlistedWrites={artifactsUnlisted} */').includes('unlistedWrites={artifactsUnlisted}'))
    .toBe(false)
  expect(stripComments('// setOutsideNote(d.outside)').includes('setOutsideNote(d.outside)')).toBe(false)
  expect(stripComments('const x = 1 // setOutsideNote(d.outside)').includes('setOutsideNote(d.outside)'))
    .toBe(false)
})
