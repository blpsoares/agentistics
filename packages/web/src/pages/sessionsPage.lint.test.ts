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

const RAW = readFileSync(join(import.meta.dir, 'SessionsPage.tsx'), 'utf-8')

/**
 * CODE ONLY — comments are stripped before anything is asserted, BLOCK COMMENTS INCLUDED.
 *
 * The file explains the bug it forbids, quoting the old expression verbatim, so a grep over the raw
 * text matches the explanation and fails on a file that is correct. Same trap `attention-rules.ts`
 * records for footer markers: a source that discusses a pattern contains that pattern.
 *
 * Line comments alone were enough while the only assertions were NEGATIVE — a leftover `/* … *\/`
 * could not make `not.toMatch` pass. The central-gate test below is POSITIVE, and its expression is
 * named in the doc comment sitting directly above the line that holds it, so a block comment would
 * satisfy it on a file that had dropped the term. Same `code()` shape as
 * `ArtifactsAside.gate.lint.test.ts`, for the same reason.
 */
const SRC = RAW
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

test('the centre is not swapped between `panel` and a wrapper around it', () => {
  // Any ternary whose branches are "the panel" and "something containing the panel" is this bug.
  expect(SRC).not.toMatch(/\?\s*panel\s*:/)
  expect(SRC).not.toMatch(/:\s*panel\s*\}/)
})

test('the edge strip is rendered INSIDE the wrapper, not as an alternative to it', () => {
  // The wrapper holds both, in this order, unconditionally — `{null}` keeps the slot when the strip
  // is absent, which is what makes both cases the same shape.
  const wrapper = /return \(\s*<div style=\{\{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 \}\}>\s*\{edgeMarker\}\s*\{panel\}/
  expect(SRC).toMatch(wrapper)
})

// Without this the greps above could pass on a file that no longer has either name, which would be
// a test that checks nothing while staying green.
test('the names this pins still exist in the file', () => {
  expect(SRC).toContain('const edgeMarker')
  expect(SRC).toContain('const panel =')
})

/**
 * THE STUDIO'S GATE CARRIES `!isCentral`, AND THIS PAGE IS WHERE IT IS APPLIED.
 *
 * `/api/fleet` is refused WHOLE on a central, and `editor-gate.ts` carries no central term — so a
 * central on a `local` profile with the preference on reports `editorEnabled: true`. The desktop
 * button in `App.tsx` spells the term out; the two entries this page owns did not, and a phone got a
 * Studio row whose every request is refused. The one value both entries read is this one, and it is
 * also the `editorEnabled` prop `ArtifactsAside` gates its strip entry and its Studio layer on — so
 * the term belongs here and nowhere else.
 *
 * Not reachable by rendering: the page needs a fleet host and `packages/web` has no jsdom. The
 * expression is what went wrong, so the expression is what is asserted — over comment-free source,
 * with the defect planted below to prove the scan can still see it.
 */
const GATE = 'const editorEnabled = ctx.editorEnabled === true && !isCentral'

/**
 * A needle, as a BOOLEAN — the lesson `ArtifactsAside.gate.lint.test.ts` records.
 *
 * `expect(SRC).toMatch(…)` on a 60 KB file prints the whole file on failure, which buries the one
 * line that says what broke. The needle is in the assertion's own line; what the report has to carry
 * is whether it is there.
 */
const has = (needle: string) => SRC.includes(needle)

test('the Studio gate is narrowed by `!isCentral`', () => {
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
  const strip = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const bare = 'const editorEnabled = ctx.editorEnabled === true\n'
  expect(strip(bare).includes(GATE)).toBe(false)
  // And the doc comment that NAMES the term cannot stand in for it — the reason block comments are
  // stripped at all. With line comments only, this case passed on a file that had dropped the term.
  expect(strip(`/**\n * ${GATE}\n */\n${bare}`).includes(GATE)).toBe(false)
  // A line comment cannot either.
  expect(strip(`// ${GATE}\n${bare}`).includes(GATE)).toBe(false)
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
  const strip = (s: string) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  // A prop passed in a comment is not a prop passed.
  expect(strip('/* unlistedWrites={artifactsUnlisted} */').includes('unlistedWrites={artifactsUnlisted}'))
    .toBe(false)
  expect(strip('// setOutsideNote(d.outside)').includes('setOutsideNote(d.outside)')).toBe(false)
})
