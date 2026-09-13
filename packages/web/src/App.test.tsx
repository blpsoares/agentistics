/**
 * App.tsx has no test file of its own — a "thousand-line component" per its own comment on the
 * Studio button block. What is tested here is exactly what §2 of the slots/references design
 * requires and nothing else: the button's own pure parts, pulled out precisely so they can be
 * asserted without clicking through the whole page in a browser (this repo has no jsdom and no
 * `@testing-library/react`, so a click cannot be simulated and `useEffect` never runs under
 * `renderToStaticMarkup` — the same constraint `Studio.test.tsx` documents).
 *
 * A fix-wave review planted six defects that left the whole web suite green with the button's
 * contract entirely unguarded (see the review's I1). Three of the six live here:
 *
 *   - `aria-pressed={studioOn}` → `aria-pressed={false}`               — covered below
 *   - the `try/catch` around `localStorage.getItem` removed            — covered below
 *   - the `try/catch` around `localStorage.setItem` removed            — covered below
 *
 * The other three (`ArtifactsAside.tsx`, `SessionsPage.tsx`'s mobile row, `artifactsStore.ts`'s
 * listener notification) are covered in `artifactsStore.test.ts` and `studioMenuRow.test.ts`.
 */
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  readStudioSeen, STUDIO_SEEN_KEY, StudioHeaderButton, studioButtonTokens, writeStudioSeen,
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

// --- studioButtonTokens: the button's border/background/colour, as a pure function of studioOn -----

test('ON draws the "Reabrir N sessões que caíram" button\'s own tokens (SessionsAside.tsx:473)', () => {
  expect(studioButtonTokens(true)).toEqual({
    border: '1px solid var(--anthropic-orange)',
    background: 'rgba(232,146,90,0.08)',
    color: 'var(--anthropic-orange)',
  })
})

test('OFF draws the neutral chrome tokens', () => {
  expect(studioButtonTokens(false)).toEqual({
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-secondary)',
  })
})

// --- StudioHeaderButton: the markup, aria-pressed and the dot ---------------------------------------

function button(studioOn: boolean, studioSeen: boolean): string {
  return renderToStaticMarkup(
    <StudioHeaderButton studioOn={studioOn} studioSeen={studioSeen} lang="en" onOpen={() => {}} />,
  )
}

/** Plant: `aria-pressed={studioOn}` → `aria-pressed={false}`. Both assertions below then read
 *  `aria-pressed="false"` and the first one fails. */
test('aria-pressed follows studioOn, in both directions', () => {
  expect(button(true, true)).toContain('aria-pressed="true"')
  expect(button(false, true)).toContain('aria-pressed="false"')
})

test('the dot is present on a fresh origin (studioSeen false) and gone once it has fired', () => {
  // Checked with the button OFF, where nothing else in the markup draws `--anthropic-orange` — the
  // ON tokens themselves use it too, which would confound this assertion.
  expect(button(false, false)).toContain('var(--anthropic-orange)')
  expect(button(false, true)).not.toContain('var(--anthropic-orange)')
})

test('the pressed ON treatment still renders once the dot has cleared', () => {
  expect(button(true, true)).toContain('rgba(232,146,90,0.08)')
})

test('the width-changing BetaTag/NewTag components are gone — only the icon and the word "Studio"', () => {
  const html = button(false, false)
  // `BetaTag` marks itself `aria-label="beta"`; `NewTag` renders the literal word as its text node.
  // The tooltip legitimately says "(beta)" in prose, which is why this checks for the COMPONENTS'
  // own markers rather than the substring "beta".
  expect(html).not.toContain('aria-label="beta"')
  expect(html).not.toContain('>new<')
  expect(html).not.toContain('>novo<')
  expect(html).toContain('>Studio<')
})
