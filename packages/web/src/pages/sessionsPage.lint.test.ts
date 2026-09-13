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
import { describe, test, expect } from 'bun:test'
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
  // The box now renders `rightSlotContent` — the Studio's own target box, or `artifactsPane`,
  // decided by `lib/panelSlots.ts`'s `layout.right` — never the pane directly, or the Studio's
  // switcher (`rightSwitcher`) would have nowhere to sit above whichever one is showing.
  expect(has('<div style={artInner}>{rightSlotContent}</div>')).toBe(true)
  expect(has('const rightSlotContent =')).toBe(true)
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

test('every Studio entry on this page is gated on that one value', () => {
  // The mobile session-menu row — built by `studioMenuRow` (`lib/studioMenuRow.ts`, W1-A), wired
  // into `...(editorEnabled ? [studioMenuRow(...)] : [])` once its own `on` wiring test lives in
  // `studioMenuRow.test.ts` — the right switcher's OWN `studio` entry (the switcher itself is no
  // longer gated wholesale — §1.5 added `cli`/`shell` entries that must stay reachable even where
  // `editorEnabled` is false), and the `StudioHost` mount that actually renders it — the Studio
  // moved out of `ArtifactsAside` (`lib/panelSlots.ts`), so the prop that used to gate ITS strip
  // entry and layer (`editorEnabled={editorEnabled}`) is gone with it; these three are what
  // replaced it.
  expect(/\.\.\.\(editorEnabled\s*\n?\s*\?\s*\[studioMenuRow\(/.test(SRC)).toBe(true)
  expect(has("shown: editorEnabled === true },")).toBe(true)
  expect(has("editorEnabled === true && isPanelShown(slotLayout, 'studio'),")).toBe(true)
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

/**
 * I4 — THE STUDIO'S MOVE-NEVER-REMOUNTS GUARANTEE HAS A MOUNT SITE, AND THE MOUNT SITE CAN BREAK IT
 * ALL BY ITSELF. `StudioHost.lint.test.ts` pins the re-parenting MECHANISM inside `StudioHost.tsx`;
 * it says nothing about how this page MOUNTS that component, and a reviewer proved the gap three
 * times over. First: adding `key={rightIsStudio ? 'right' : 'bottom'}` to a hand-written
 * `cond && (<StudioHost .../>)` — every test in the suite at the time stayed green, because
 * `StudioHost.lint.test.ts` only reads `StudioHost.tsx` and `panelSlots.test.ts` never renders
 * anything. THE FIX for that was moving the mount through `lib/panelSlots.ts`'s `mountPanel`, pinned
 * against REAL `React.ReactElement` objects in `panelSlots.mountPanel.test.ts`. Second, in the
 * RE-REVIEW: adding `key: rightIsStudio ? 'right' : 'bottom',` into the literal PROPS object at that
 * call, still inside this page — `panelSlots.mountPanel.test.ts` only ever called `mountPanel` with a
 * `Dummy` component and hand-built props, so it never touched THIS call site and stayed green; only
 * this file's own source scan (a full scan of the literal, back then) caught it.
 *
 * THAT SCAN WAS THEN WEAKENED, and a THIRD re-review caught it: the fix that introduced
 * `mountStudioHostPanel` (the module-level function above) replaced the working "scan the whole
 * literal for a `key:` field, anywhere" test with one that only checks how many times the fixed
 * `CALL_GUARD` PREFIX string occurs. A `key` planted as the object's FIRST field still broke that
 * prefix string and was still (coincidentally) caught; a `key` planted as its LAST field, after
 * `target: studioTarget,`, left the prefix untouched and passed every `bun test` in the suite
 * — only `bun tsc --noEmit` caught it, and only because a directly-passed object literal still
 * triggers excess-property checking regardless of field order. The whole-literal scan below is that
 * protection RESTORED, not a new one — see `SRC.slice(start, close)` rather than a fixed-string
 * `.split(...).length`.
 *
 * `mountStudioHostPanel` also carries `studioHostMount.test.ts` (genuine structural coverage of the
 * function's own contract, calling it directly with real `React.ReactElement` objects) and
 * `studioHostMountParams.types.test.ts` (`StudioHostMountParams.key: never`, a TYPE-level guarantee
 * that reaches shapes NEITHER a source scan nor a call through the real function can see — a `key`
 * routed through an intermediate typed variable, or merged in via a later spread, since neither one
 * puts `key:` as literal text near this call, and neither one calls `mountStudioHostPanel` with a
 * bare `key` field for `studioHostMount.test.ts` to catch either).
 *
 * So THIS file owns two things: the SHAPE of the JSX call (exactly one, passing the same `shown`
 * condition every gate on this page uses rather than a slot-dependent ternary), and the CONTENT of
 * its literal (no `key:` field, at any position).
 */
describe('StudioHost is mounted once, through mountStudioHostPanel (I4)', () => {
  const CALL_GUARD = "mountStudioHostPanel({\n        shown: editorEnabled === true && isPanelShown(slotLayout, 'studio'),"
  // The literal's own closing tokens: `}` closes the object, `)` closes the call, `}` closes the
  // JSX expression container — `{selected && mountStudioHostPanel({ ... })}`.
  const CALL_CLOSE = '\n      })}'

  test('the bare identifier appears exactly three times: twice on the import line, once in mountStudioHostPanel\'s own call to mountPanel', () => {
    expect([...SRC.matchAll(/\bStudioHost\b/g)]).toHaveLength(3)
  })

  test('the one call site passes the SAME `shown` condition every gate on this page uses, not a slot-dependent ternary', () => {
    expect(has(CALL_GUARD)).toBe(true)
    expect(SRC).not.toMatch(/rightIsStudio\s*\?\s*mountStudioHostPanel/)
    expect(SRC).not.toMatch(/bottomIsStudio\s*\?\s*mountStudioHostPanel/)
  })

  test('the call-site guard appears exactly once — a second, byte-identical mount call would be caught', () => {
    // This pins a DIFFERENT invariant than the key scan below (a second mount SITE, not a stray
    // field on this one) — it is deliberately not relied on for I4's own guarantee any more.
    const occurrences = SRC.split(CALL_GUARD).length - 1
    expect(occurrences).toBe(1)
    const secondMount = `${SRC}\n${CALL_GUARD} sessionId: 'x' })`
    expect(secondMount.split(CALL_GUARD).length - 1).toBe(2)
  })

  test('the scan still sees the guard move away from the call', () => {
    expect(has(CALL_GUARD)).toBe(true) // sanity: the needle exists in the real file
    const guardMovedAway = SRC.replace(CALL_GUARD, "editorEnabled === true && isPanelShown(slotLayout, 'studio') && (\n        <div />")
    expect(guardMovedAway.includes(CALL_GUARD)).toBe(false)
  })

  test('the props object handed to mountStudioHostPanel carries no `key` field, at ANY position in the literal', () => {
    const start = SRC.indexOf(CALL_GUARD)
    const close = SRC.indexOf(CALL_CLOSE, start)
    expect(start).toBeGreaterThan(-1)
    expect(close).toBeGreaterThan(start)
    expect(SRC.slice(start, close)).not.toMatch(/(^|[,{])\s*key\s*:/)
  })

  test('the scan still sees a `key` field slipped into the props object, whichever position it is added at', () => {
    // FIRST field — the shape the original review planted, and the shape the occurrence-count test
    // above (coincidentally) still catches because it breaks the CALL_GUARD prefix string.
    const first = SRC.replace(
      CALL_GUARD,
      "mountStudioHostPanel({\n        key: rightIsStudio ? 'right' : 'bottom',\n        shown: editorEnabled === true && isPanelShown(slotLayout, 'studio'),",
    )
    const firstStart = first.indexOf('mountStudioHostPanel({')
    const firstClose = first.indexOf(CALL_CLOSE, firstStart)
    expect(first.slice(firstStart, firstClose)).toMatch(/(^|[,{])\s*key\s*:/)

    // LAST field, appended right before the closing `})}` — the shape the re-review found that the
    // occurrence-count test cannot see at all, because it never touches the fixed prefix string.
    const last = SRC.replace(
      'target: studioTarget,' + CALL_CLOSE,
      "target: studioTarget,\n        key: rightIsStudio ? 'right' : 'bottom'," + CALL_CLOSE,
    )
    const lastStart = last.indexOf(CALL_GUARD)
    const lastClose = last.indexOf(CALL_CLOSE, lastStart)
    expect(last.slice(lastStart, lastClose)).toMatch(/(^|[,{])\s*key\s*:/)
  })
})
