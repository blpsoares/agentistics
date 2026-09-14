/**
 * App.tsx has no test file of its own — a "thousand-line component" per its own comment on the
 * Studio button block. What is tested here is exactly what §2 of the slots/references design
 * requires and nothing else: the header switcher's own pure parts, pulled out precisely so they can
 * be asserted without clicking through the whole page in a browser (this repo has no jsdom and no
 * `@testing-library/react`, so a click cannot be simulated and `useEffect` never runs under
 * `renderToStaticMarkup` — the same constraint `Studio.test.tsx` documents).
 *
 * A fix-wave review planted six defects that left the whole web suite green with the button's
 * contract entirely unguarded (see that review's I1). Three of the six live here:
 *
 *   - `aria-pressed={studioOn}` → `aria-pressed={false}`               — covered below
 *   - the `try/catch` around `localStorage.getItem` removed            — covered below
 *   - the `try/catch` around `localStorage.setItem` removed            — covered below
 *
 * The other three (`ArtifactsAside.tsx`, `SessionsPage.tsx`'s mobile row, `artifactsStore.ts`'s
 * listener notification) are covered in `artifactsStore.test.ts` and `studioMenuRow.test.ts`.
 *
 * `StudioHeaderButton` — the single Studio-only button this section used to test — is GONE (a
 * second fix-wave review's Important #2): `SessionHeaderSwitcher` superseded it entirely, and
 * nothing in production referenced it any more. Its `aria-pressed`/dot coverage below is replaced
 * by the same assertions against `SessionHeaderSwitcher`'s own markup — the single lit control and
 * the first-open dot are the behaviours that actually ship now.
 */
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { headerSwitcherEntries } from './lib/sessionHeaderSwitcher'
import {
  readStudioSeen, SessionHeaderSwitcher, STUDIO_SEEN_KEY, writeStudioSeen,
} from './App'

// --- readStudioSeen / writeStudioSeen: the dot's own persistence, and the private-mode floor -------

test('readStudioSeen answers false before anything has been written', () => {
  const store = new Map<string, string>()
  expect(readStudioSeen({ getItem: k => store.get(k) ?? null })).toBe(false)
})

test('readStudioSeen answers true once the flag has actually been written', () => {
  const store = new Map<string, string>([[STUDIO_SEEN_KEY, '1']])
  expect(readStudioSeen({ getItem: k => store.get(k) ?? null })).toBe(true)
})

/** Plant: drop the `try/catch` in `readStudioSeen`. A throwing `getItem` then propagates out of this
 *  call instead of being tolerated, and this assertion never gets to run. */
test('readStudioSeen tolerates a throwing getItem, answering not-seen rather than crashing', () => {
  const throwing = { getItem: () => { throw new Error('SecurityError: denied') } }
  expect(readStudioSeen(throwing)).toBe(false)
})

test('writeStudioSeen actually persists the flag when storage cooperates', () => {
  const store = new Map<string, string>()
  writeStudioSeen({ setItem: (k, v) => { store.set(k, v) } })
  expect(store.get(STUDIO_SEEN_KEY)).toBe('1')
})

/** Plant: drop the `try/catch` in `writeStudioSeen`. A throwing `setItem` then propagates and this
 *  `not.toThrow()` fails. */
test('writeStudioSeen tolerates a throwing setItem, never throwing itself', () => {
  const throwing = { setItem: () => { throw new Error('SecurityError: denied') } }
  expect(() => writeStudioSeen(throwing)).not.toThrow()
})

// --- SessionHeaderSwitcher: exactly one lit tab (two with Studio at the bottom), and the first-open
// dot -----------------------------------------------------------------------------------------------
//
// `headerSwitcherEntries` (lib/sessionHeaderSwitcher.test.ts) already pins the DATA-level invariant.
// What is tested here is that the COMPONENT actually threads that into the markup (`aria-selected`)
// rather than, say, always rendering `false` — the exact shape of the `aria-pressed={studioOn} →
// aria-pressed={false}` defect this section used to guard against on the button `SessionHeaderSwitcher`
// replaced, plus item 1's own "one segmented control, not five separate pills" and the tag.

const ALL_GATES = { editorEnabled: true, shellEnabled: true, relayed: false, hardwareOffered: true }

function switcher(
  rightOccupant: 'contents' | 'studio' | 'cli' | 'shell' | 'hardware' | null,
  bottomOccupant: 'cli' | 'shell' | 'studio' | null,
  studioSeen: boolean,
): string {
  return renderToStaticMarkup(
    <SessionHeaderSwitcher
      entries={headerSwitcherEntries(rightOccupant, bottomOccupant, ALL_GATES)}
      lang="en"
      studioSeen={studioSeen}
      cliLabel="Claude Code"
      shellLabel="Shell"
      onPick={() => {}}
    />,
  )
}

/** Plant: force every entry's `on` to `false` regardless of `entries`. The first assertion then
 *  fails (Studio active should read `aria-selected="true"`); force it to `true` instead and the
 *  second one fails (nothing active should read `aria-selected="true"` nowhere at all). */
test('aria-selected follows which entry is active, in both directions', () => {
  expect(switcher('studio', null, true)).toContain('aria-selected="true"')
  const nothingActive = switcher(null, null, true)
  expect(nothingActive).not.toContain('aria-selected="true"')
  expect(nothingActive.match(/aria-selected="false"/g)?.length).toBe(5)
})

/** Plant: drop the `rightOccupant === e.id` check in `headerSwitcherEntries`, defaulting every `on`
 *  to the same value. This assertion then sees either zero or five `true`s instead of exactly one. */
test('exactly one tab is ever lit, matching the design\'s "never more than one lit control"', () => {
  const html = switcher('studio', null, true)
  expect(html.match(/aria-selected="true"/g)?.length).toBe(1)
  expect(html.match(/aria-selected="false"/g)?.length).toBe(4)
})

// Owner follow-up (screenshot 5): "the Studio must be ACTIVE from the moment it is open... with a
// small tag saying where it is open". Studio docked at the bottom while Contents holds the right
// slot is the one case two tabs read `on` at once.
test('Studio at the bottom, Contents on the right: BOTH lit, Studio carries the "embaixo"/"bottom" tag', () => {
  const html = switcher('contents', 'studio', true)
  expect(html.match(/aria-selected="true"/g)?.length).toBe(2)
  expect(html).toContain('Studio · bottom')
})

test('Studio in the right slot carries the "side" tag', () => {
  expect(switcher('studio', null, true)).toContain('Studio · side')
})

test('Studio shown nowhere carries no tag at all', () => {
  const html = switcher('contents', null, true)
  expect(html).not.toContain('Studio ·')
  expect(html).toContain('>Studio<')
})

test('the tag is in Portuguese too', () => {
  const html = renderToStaticMarkup(
    <SessionHeaderSwitcher
      entries={headerSwitcherEntries('contents', 'studio', ALL_GATES)}
      lang="pt"
      studioSeen={true}
      cliLabel="Claude Code"
      shellLabel="Shell"
      onPick={() => {}}
    />,
  )
  expect(html).toContain('Studio · embaixo')
})

test('the dot is present on a fresh origin (studioSeen false) and gone once it has fired', () => {
  // Checked with nothing active, where nothing else in the markup draws `--anthropic-orange` — the
  // ON tokens themselves use it too, which would confound this assertion.
  expect(switcher(null, null, false)).toContain('var(--anthropic-orange)')
  expect(switcher(null, null, true)).not.toContain('var(--anthropic-orange)')
})

/** Item 1: ONE segmented control, the same visual language as the band's own `Claude Code | Shell |
 *  Studio` segment — `var(--bg-surface)`/`var(--text-primary)` for the lit tab, never a bespoke
 *  orange-bordered pill per entry. Plant: revert to the old per-entry `rgba(232,146,90,0.08)`
 *  treatment and this fails. */
test('the ON treatment matches the band segment\'s own tab styling, not a bespoke pill', () => {
  const html = switcher('studio', null, true)
  expect(html).toContain('background:var(--bg-surface)')
  expect(html).toContain('color:var(--text-primary)')
  expect(html).not.toContain('rgba(232,146,90,0.08)')
})

/** Item 1/3: the five entries render inside ONE `role="tablist"` wrapper — never five separate
 *  bordered pills each carrying their own border/background. */
test('one wrapper, one role="tablist" — not five separate pill buttons', () => {
  const html = switcher('studio', null, true)
  expect(html.match(/role="tablist"/g)?.length).toBe(1)
  expect(html.match(/role="tab"/g)?.length).toBe(5)
})

test('the entries render in the design\'s fixed order — Conteúdo · Studio · Claude Code · Shell · Hardware', () => {
  const html = switcher('studio', null, true)
  const order = [...html.matchAll(/<span>([^<]+)<\/span>/g)].map(m => m[1])
  expect(order).toEqual(['Contents', 'Studio · side', 'Claude Code', 'Shell', 'Hardware'])
})
