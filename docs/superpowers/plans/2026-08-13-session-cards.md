# Session cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the cockpit's sessions pane a second layout — a paginated grid of cards, at most ten to a page — beside the list it already draws.

**Architecture:** Every width, height, count and hit test is a pure function in `packages/tui/src/control/sessions.ts` with a test that sweeps terminal sizes; `tabs/Sessions.tsx` draws what the module decided and owns no geometry. The card grid reuses the existing `Pane` component for each card, so a card is framed exactly like every other region of this application.

**Tech Stack:** Bun, TypeScript (strict), React + Ink, `bun test`.

## Global Constraints

- **The project is English-only**: code, comments, commit messages, PR title and body. User-facing strings go in BOTH `i18n.ts` tables (EN and PT).
- **Width is measured, never guessed.** A row wider than its pane wraps and shears every row below it. Any width decision is a pure function in `sessions.ts` with a sweep test.
- **Height is measured, never guessed.** Ink COMPOSITES rows past the given `height` on top of the rows below — that reads as a corrupted frame. Budget against the `height` prop; `Math.max(1, height - chrome)` is the shape of the bug, not the fix.
- **A restored preference falls back to `DEFAULT_SESSION_VIEW`, never to a literal.** `?? false` on a field whose default is `true` has already shipped here once and turned a filter off on every machine that had a `preferences.json`.
- **No confident zero.** An absent fact is an absent line, never `0 tokens`.
- **Every key the footer names must work, and every key that works should be named.**
- Verify with `bun tsc --noEmit`, `bun test` (baseline on this branch: **3416 passing**), and the preview sweep.
- Commit style: Conventional Commits with a scope, in English, explaining WHY.
- Work stays on the current branch `feat/session-cards` in this worktree.

---

### Task 1: The grid and the page — pure arithmetic

**Files:**
- Modify: `packages/tui/src/control/sessions.ts` (append a new section at the end)
- Test: `packages/tui/src/control/sessions.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `PANE_FRAME_Y` (already imported at the top of `sessions.ts`).
- Produces: `SessionLayout`, `CARD_PAGE_MAX`, `CARD_GAP`, `CARD_MIN_WIDTH`, `CARD_MAX_WIDTH`, `CARD_LINES`, `CARD_MIN_LINES`, `CardGrid`, `cardGrid(o: {width: number; height: number; total: number}): CardGrid | null`, `CardPage`, `cardPage(total: number, capacity: number, page: number): CardPage`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/tui/src/control/sessions.test.ts`. Add `cardGrid, cardPage, CARD_PAGE_MAX, CARD_MIN_WIDTH, CARD_GAP` to the existing `import { … } from './sessions'` at the top of the file.

```ts
describe('cardGrid', () => {
  // Two columns too wide is not a cosmetic miss: the frame truncates every card it just measured.
  // Two rows too tall is worse — Ink composites the overflow onto the rows below rather than
  // clipping it, which reads as a corrupted frame rather than a cramped one.
  it('never draws a grid wider or taller than the region it was measured against', () => {
    for (let w = 10; w <= 200; w++) {
      for (let h = 2; h <= 44; h++) {
        const g = cardGrid({ width: w, height: h, total: 40 })
        if (!g) continue
        expect(g.cols * g.cardWidth + CARD_GAP * (g.cols - 1)).toBeLessThanOrEqual(w)
        expect(g.rows * g.cardHeight).toBeLessThanOrEqual(h)
        expect(g.cardWidth).toBeGreaterThanOrEqual(CARD_MIN_WIDTH)
      }
    }
  })

  it('gives up rather than drawing a card that cannot hold one', () => {
    expect(cardGrid({ width: CARD_MIN_WIDTH - 1, height: 40, total: 9 })).toBeNull()
    expect(cardGrid({ width: 120, height: 4, total: 9 })).toBeNull()
  })

  // Ten is the CAP, not the promise: a page holds what the grid can actually show, so there is
  // never a card on the page that the reader has to scroll to reach.
  it('never offers a page above the cap', () => {
    for (let w = 28; w <= 200; w++) {
      const g = cardGrid({ width: w, height: 44, total: 200 })
      if (g) expect(g.capacity).toBeLessThanOrEqual(CARD_PAGE_MAX)
    }
  })

  // A grid shaped for ten cards while the fleet has three is nine empty holes and three cards.
  it('shapes itself to the fleet, not to the cap', () => {
    const g = cardGrid({ width: 180, height: 40, total: 3 })!
    expect(g.cols * g.rows).toBeLessThanOrEqual(4)
    expect(g.capacity).toBeLessThanOrEqual(3)
  })

  it('spends surplus width on wider cards rather than on more columns than the page can use', () => {
    const g = cardGrid({ width: 200, height: 40, total: 4 })!
    expect(g.cols).toBeLessThanOrEqual(4)
    expect(g.cardWidth).toBeGreaterThan(CARD_MIN_WIDTH)
  })
})

describe('cardPage', () => {
  it('reports the pages a total actually needs', () => {
    expect(cardPage(47, 6, 0)).toEqual({ page: 0, pages: 8, from: 0, to: 6 })
    expect(cardPage(12, 6, 1)).toEqual({ page: 1, pages: 2, from: 6, to: 12 })
  })

  // The list re-sorts every five seconds and a filter can empty it between two polls, so a page
  // index is always one frame away from pointing past the end — and that is the frame someone
  // presses a key on.
  it('clamps a page left pointing past the end', () => {
    expect(cardPage(7, 6, 9)).toEqual({ page: 1, pages: 2, from: 6, to: 7 })
    expect(cardPage(0, 6, 3)).toEqual({ page: 0, pages: 1, from: 0, to: 0 })
    expect(cardPage(7, 0, 0).pages).toBe(7)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/tui/src/control/sessions.test.ts`
Expected: FAIL — `cardGrid is not defined` / `cardPage is not defined` (or a TS resolution error on the import).

- [ ] **Step 3: Write the implementation**

Append to `packages/tui/src/control/sessions.ts`:

```ts
// ---------------------------------------------------------------------------
// the card grid
// ---------------------------------------------------------------------------

/**
 * How the fleet is ARRANGED — the same rows, two shapes.
 *
 * The list is the right shape for scanning forty sessions and the wrong shape for reading one:
 * what a session is saying, which model it runs, the note left on it and how long it has been
 * going exist only in the detail pane, one selection at a time. A card carries them all at once.
 */
export type SessionLayout = 'list' | 'cards'

/**
 * The most cards one page may hold.
 *
 * A CAP rather than a page size: ten cards rarely fit — at 130x30 the pane carries six — and a
 * fixed ten would have to SCROLL inside the page, which is two mechanisms for reaching one card.
 * The page is what the grid can actually show, and on a terminal that can carry ten it is ten.
 */
export const CARD_PAGE_MAX = 10

/** One column between two cards. The frames already separate them; a wider gutter is spent air. */
export const CARD_GAP = 1

/**
 * The narrowest card worth drawing, frame included.
 *
 * `PANE_FRAME_X` of that is border and padding, so the floor leaves 24 columns for a name — below
 * which every card is an ellipsis and the grid says less than the list it replaced.
 */
export const CARD_MIN_WIDTH = 28

/**
 * The widest a card is allowed to grow, so a fleet of three on a 200-column terminal draws three
 * readable cards rather than three billboards. The same bounded-growth rule the aside menu follows.
 */
export const CARD_MAX_WIDTH = 46

/** Content lines a full card carries: name, state, usage, where, and what it is saying. */
export const CARD_LINES = 5

/** The fewest a card is worth: the name, the state, and one fact. Below that it is a list row. */
export const CARD_MIN_LINES = 3

export interface CardGrid {
  /** Cards across. */
  cols: number
  /** Rows of cards. */
  rows: number
  /** Columns per card, FRAME INCLUDED. */
  cardWidth: number
  /** Rows per card, FRAME INCLUDED. */
  cardHeight: number
  /** Columns between two cards. */
  gap: number
  /** How many cards one page holds — `cols * rows`, never above `CARD_PAGE_MAX`. */
  capacity: number
}

/**
 * The grid a region can carry — PURE, and `null` when it cannot carry one whole card.
 *
 * `null` is a real answer, not a failure: on a short or narrow terminal the screen falls back to
 * the list, which is the same degradation the aside menu makes when it is dropped rather than
 * squeezed. A grid drawn into a region too small for it is composited over the rows below.
 *
 * The shape is decided by the FLEET rather than by the cap: a 6x2 grid holding three sessions is
 * three cards and nine holes. So the rows are the fewest that can carry what will be shown, the
 * columns are the fewest that can place them in those rows, and every column left over is spent
 * making the cards WIDER rather than making more of them.
 */
export function cardGrid(o: { width: number; height: number; total: number }): CardGrid | null {
  const width = Math.max(0, o.width)
  const height = Math.max(0, o.height)
  const floorHeight = PANE_FRAME_Y + CARD_MIN_LINES
  const fullHeight = PANE_FRAME_Y + CARD_LINES
  if (width < CARD_MIN_WIDTH || height < floorHeight) return null

  // How many the region could carry at the floor — the ceiling on everything below.
  const maxCols = Math.max(1, Math.floor((width + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)))
  const maxRows = Math.max(1, Math.floor(height / floorHeight))
  const want = Math.max(1, Math.min(Math.max(0, o.total), CARD_PAGE_MAX))

  const rows = Math.max(1, Math.min(maxRows, Math.ceil(want / maxCols)))
  const cols = Math.max(1, Math.min(maxCols, Math.ceil(want / rows)))
  // The floor is unreachable — `cols <= maxCols` guarantees it — and stated anyway, because this is
  // the one line whose being wrong truncates every card by the frame it was measured against.
  const cardWidth = Math.max(
    CARD_MIN_WIDTH,
    Math.min(CARD_MAX_WIDTH, Math.floor((width - CARD_GAP * (cols - 1)) / cols)),
  )
  // As tall as the band affords, never taller than the card has content for: rows of blank inside
  // a frame are not a card, they are a box with a name in it.
  const cardHeight = Math.min(fullHeight, Math.floor(height / rows))

  return {
    cols, rows, cardWidth, cardHeight, gap: CARD_GAP,
    capacity: Math.min(cols * rows, CARD_PAGE_MAX),
  }
}

export interface CardPage {
  /** The page actually in force, clamped into range. */
  page: number
  pages: number
  /** Index of the first card of this page, and one past its last. */
  from: number
  to: number
}

/**
 * Which slice of the fleet a page names — PURE, and CLAMPED on every call.
 *
 * Clamped rather than corrected in an effect, for the same reason the list's cursor is: a session
 * that ends between two polls shortens the list under the page, and a stored index would point past
 * the end for exactly one frame — which is the frame the user presses a key on.
 */
export function cardPage(total: number, capacity: number, page: number): CardPage {
  const size = Math.max(1, capacity)
  const count = Math.max(0, total)
  const pages = Math.max(1, Math.ceil(count / size))
  const at = Math.max(0, Math.min(Math.floor(page), pages - 1))
  const from = at * size
  return { page: at, pages, from, to: Math.min(count, from + size) }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/tui/src/control/sessions.test.ts`
Expected: PASS, and the file's existing tests still pass.

- [ ] **Step 5: Type check and commit**

```bash
bun tsc --noEmit
git add packages/tui/src/control/sessions.ts packages/tui/src/control/sessions.test.ts
git commit -m "$(cat <<'EOF'
feat(sessions): the grid a card layout can actually carry

Ten cards to a page is a cap rather than a size: at 130x30 the pane carries
six, and a fixed ten would have to scroll INSIDE the page — two mechanisms
for reaching one card. The grid is also shaped by the fleet rather than by
the cap, because a 6x2 grid holding three sessions is three cards and nine
holes, and it returns null rather than drawing into a region too small for
one card: Ink composites that overflow onto the rows below instead of
clipping it, which reads as a corrupted frame.
EOF
)"
```

---

### Task 2: What a card SAYS — pure content

**Files:**
- Modify: `packages/tui/src/control/sessions.ts`
- Test: `packages/tui/src/control/sessions.test.ts`

**Interfaces:**
- Consumes: `SessionRow` and `ControlSession` (both already in the module), `sessionHandle`, `worktreeName`, `sessionMetric` (already exported from this module).
- Produces: `CardLine`, `CardLabels`, `cardBadges(rows: readonly SessionRow[]): string[]`, `cardLines(s: ControlSession, labels: CardLabels): CardLine[]`, `fitCardLines(lines: readonly CardLine[], rows: number): CardLine[]`, `cardStateCells(state: string, tail: string, width: number): {state: string; tail: string}`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/tui/src/control/sessions.test.ts`, and add `cardBadges, cardLines, fitCardLines, cardStateCells` plus `type CardLine, type SessionRow` to the import list. The file already has a `session(id, over)` helper at line 17 — use it rather than building a second fixture.

```ts
describe('cardBadges', () => {
  it('names each card with the heading the list would have drawn above it', () => {
    const rows: SessionRow[] = [
      { kind: 'heading', label: 'agentistics', count: 2 },
      { kind: 'session', session: session('a') },
      { kind: 'spacer' },
      { kind: 'heading', label: 'agentistics · closed', count: 1, muted: true },
      { kind: 'session', session: session('b') },
    ]
    expect(cardBadges(rows)).toEqual(['agentistics', 'agentistics · closed'])
  })

  // With grouping off there is no heading at all, and a card with a blank badge is a frame with a
  // gap in it. The project is the fact every session already carries.
  it('falls back to the project when there is no heading', () => {
    const rows: SessionRow[] = [
      { kind: 'session', session: session('a', { project: 'notes', projectGroup: 'agentistics' }) },
    ]
    expect(cardBadges(rows)).toEqual(['agentistics'])
  })
})

describe('cardLines', () => {
  const labels = { attached: 'attached', blind: 'approval unknown', ago: () => '22min ago' }
  const base = session('a1b2c3', { title: 'migrate the auth store', harness: 'claude' })

  it('always carries the name and the state, in that order', () => {
    const lines = cardLines(base, labels)
    expect(lines[0]).toMatchObject({ kind: 'title', text: 'migrate the auth store' })
    // The helper's default state is `waiting` / `waiting`.
    expect(lines[1]).toMatchObject({ kind: 'state', text: 'waiting' })
  })

  // A harness that cannot report usage would otherwise show every one of its sessions costing
  // nothing, which is a confident wrong number in the place a person looks to decide what to close.
  it('omits the usage line entirely when nothing was recorded', () => {
    expect(cardLines(base, labels).some(l => l.key === 'usage')).toBe(false)
    const priced = cardLines({ ...base, tokens: '51.7k', cost: '$1.24' }, labels)
    expect(priced.find(l => l.key === 'usage')?.text).toBe('51.7k $1.24')
  })

  it('omits what it is saying when the host reported nothing', () => {
    expect(cardLines(base, labels).some(l => l.kind === 'say')).toBe(false)
    const talking = cardLines({ ...base, lastLines: ['running the migration'] }, labels)
    expect(talking.find(l => l.kind === 'say')?.text).toBe('running the migration')
  })

  it('marks an attached session and one whose approvals cannot be read', () => {
    const line = cardLines({ ...base, attached: true, approvalBlind: 'no markers' }, labels)[1]!
    expect(line.tail).toContain('attached')
    expect(line.tail).toContain('approval unknown')
  })
})

describe('fitCardLines', () => {
  const line = (key: string, kind: 'title' | 'state' | 'fact'): CardLine => ({ key, kind, text: key })

  it('cuts from the bottom and never gives up the name or the state', () => {
    const lines = [line('t', 'title'), line('s', 'state'), line('a', 'fact'), line('b', 'fact')]
    expect(fitCardLines(lines, 2).map(l => l.key)).toEqual(['t', 's'])
    expect(fitCardLines(lines, 0)).toEqual([])
    expect(fitCardLines(lines, 9)).toHaveLength(4)
  })
})

describe('cardStateCells', () => {
  // The state is the one cell nothing else on a card repeats — the same rule `sessionCells` keeps
  // for the row. The tail (harness, markers) is said again by the colour and by the detail pane.
  it('gives up the tail before the state word', () => {
    expect(cardStateCells('needs approval', ' · claude', 40))
      .toEqual({ state: 'needs approval', tail: ' · claude' })
    expect(cardStateCells('needs approval', ' · claude', 16))
      .toEqual({ state: 'needs approval', tail: '' })
    expect(cardStateCells('needs approval', ' · claude', 8).tail).toBe('')
    expect(cardStateCells('needs approval', ' · claude', 8).state.length).toBeLessThanOrEqual(8)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/tui/src/control/sessions.test.ts`
Expected: FAIL — `cardBadges is not defined` and the rest.

- [ ] **Step 3: Write the implementation**

Append to `packages/tui/src/control/sessions.ts`:

```ts
// ---------------------------------------------------------------------------
// what a card says
// ---------------------------------------------------------------------------

/**
 * The group each card belongs to, in the order the cards are drawn — PURE.
 *
 * Taken from the HEADING the list would have drawn above that row, never re-derived from the
 * session: `sessionRows` already decides what a group is called, including the history section, a
 * finished task's suffix and the localized word for an absent key. Working it out a second way is a
 * second implementation of the grouping, and the two would disagree the first time either changed.
 *
 * With grouping off there is no heading, and the card falls back to the project — the fact every
 * session already carries. A blank badge is a frame with a gap in it.
 */
export function cardBadges(rows: readonly SessionRow[]): string[] {
  const out: string[] = []
  let heading = ''
  for (const row of rows) {
    if (row.kind === 'heading') { heading = row.label; continue }
    if (row.kind !== 'session') continue
    out.push(heading || row.session.projectGroup || row.session.project)
  }
  return out
}

/** What a card line IS, so the component can colour it without parsing it back. */
export type CardLineKind = 'title' | 'state' | 'fact' | 'say'

export interface CardLine {
  key: string
  kind: CardLineKind
  text: string
  /** Drawn dim on the same row, after `text`. Given up first when the card is narrow. */
  tail?: string
}

/** The already-localized words a card needs. This module owns no strings. */
export interface CardLabels {
  /** Said on a session whose terminal is currently handed over. */
  attached: string
  /** Short caveat for a harness with no probed approval markers. */
  blind: string
  ago: (startedAt: number) => string
}

/**
 * Everything a card can say about one session, most identifying first — PURE.
 *
 * The order IS the give-up order: `fitCardLines` cuts from the bottom, so the name and the state
 * are the two a card can never lose — the name because a card you cannot identify is not one you
 * can act on, the state because nothing else on the frame says whether this session is waiting for
 * you.
 *
 * A fact that was never recorded is an ABSENT line, never a zero: a harness that cannot report
 * usage would otherwise show every one of its sessions costing nothing, in the very place a person
 * looks to decide what to close. Same rule the detail pane and `sessionMetric` already follow.
 */
export function cardLines(s: ControlSession, labels: CardLabels): CardLine[] {
  const marks = [
    s.attached ? labels.attached : '',
    s.approvalBlind ? labels.blind : '',
  ].filter(Boolean)
  const tail = [s.harness, ...marks].filter(Boolean).join(' · ')

  const out: CardLine[] = [
    { key: 'title', kind: 'title', text: s.title },
    { key: 'state', kind: 'state', text: s.stateLabel, ...(tail ? { tail: ` · ${tail}` } : {}) },
  ]

  const usage = [sessionMetric(s), s.startedAt !== undefined ? labels.ago(s.startedAt) : '']
    .filter(Boolean).join(' · ')
  if (usage) out.push({ key: 'usage', kind: 'fact', text: usage })

  // WHERE, and which checkout of it: with several worktrees of one repository open at once, the
  // folder name is the only thing telling them apart.
  const where = [worktreeName(s) || s.projectGroup || s.project, s.model].filter(Boolean).join(' · ')
  if (where) out.push({ key: 'where', kind: 'fact', text: where })

  if (s.task) out.push({ key: 'task', kind: 'fact', text: s.task })
  if (s.note) out.push({ key: 'note', kind: 'fact', text: s.note })

  // What it is SAYING, last, because it is the line a short card gives up first — and the only one
  // that would be invented if it were not there. Present only for a session agentop hosts.
  const say = s.lastLines?.[0]
  if (say) out.push({ key: 'say', kind: 'say', text: say })

  return out
}

/** The lines that fit, cut from the BOTTOM — so the name and the state are the two that survive. */
export function fitCardLines(lines: readonly CardLine[], rows: number): CardLine[] {
  return lines.slice(0, Math.max(0, rows))
}

/**
 * The state row's two halves, fitted — PURE.
 *
 * The state WORD is what a card may never give up, exactly as `sessionCells` keeps it for a row:
 * the harness is said again by the card's colour, the markers are said again by the detail pane,
 * but nothing else on the card says whether this session is waiting for you.
 */
export function cardStateCells(state: string, tail: string, width: number): {
  state: string
  tail: string
} {
  const room = Math.max(0, width)
  if (state.length + tail.length <= room) return { state, tail }
  if (state.length <= room) return { state, tail: '' }
  return { state: truncateCell(state, room), tail: '' }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/tui/src/control/sessions.test.ts`
Expected: PASS.

- [ ] **Step 5: Make room for the badge `paneTop` would otherwise drop**

`paneTop` draws a badge WHOLE OR NOT AT ALL (`chrome.ts:356` — "`nativ…` is not a terser badge, it
is a badge that has stopped answering"). That rule is right for a status the pane's own rows repeat,
and wrong for the card's group, which nothing else on the card says: on a 28-column card the group
would silently vanish. So the caller has to fit it, and the arithmetic belongs where the rule lives.

Add to `packages/tui/src/control/chrome.ts`, directly after `paneTop`:

```ts
/**
 * The widest badge `paneTop` will actually DRAW beside this title — PURE.
 *
 * Its rule is whole-or-nothing, which is right for a badge the pane's rows repeat and wrong for one
 * that is the only place a fact appears: a card's group would simply disappear on a narrow card,
 * and a card that does not say which project it belongs to is the feature not working. A caller
 * with such a badge truncates it against this rather than guessing at the frame's overhead.
 */
export function paneBadgeRoom(title: string, width: number): number {
  if (width < TOP_MIN) return 0
  const budget = width - TOP_OVERHEAD
  const shownTitle = truncate(title, Math.max(1, budget - 1))
  return Math.max(0, budget - shownTitle.length - 3)
}
```

Add to `packages/tui/src/control/chrome.test.ts` (import `paneBadgeRoom` and `paneTop` there):

```ts
describe('paneBadgeRoom', () => {
  // The contract is exact: a badge cut to this length must actually be DRAWN, and one character
  // longer must be the case `paneTop` drops. A room that is merely "about right" is a badge that
  // vanishes on some widths and not others.
  it('is exactly the length paneTop will draw', () => {
    for (let w = 0; w <= 80; w++) {
      const room = paneBadgeRoom('3f5f', w)
      if (room === 0) continue
      expect(paneTop('3f5f', 'x'.repeat(room), w).badge).toBe('x'.repeat(room))
      expect(paneTop('3f5f', 'x'.repeat(room + 1), w).badge).toBe('')
    }
  })

  it('answers zero on a pane with no room for one', () => {
    expect(paneBadgeRoom('3f5f', 6)).toBe(0)
    expect(paneBadgeRoom('3f5f', 0)).toBe(0)
  })
})
```

Run: `bun test packages/tui/src/control/chrome.test.ts`
Expected: PASS.

- [ ] **Step 6: Type check and commit**

```bash
bun tsc --noEmit
git add packages/tui/src/control/sessions.ts packages/tui/src/control/sessions.test.ts \
        packages/tui/src/control/chrome.ts packages/tui/src/control/chrome.test.ts
git commit -m "$(cat <<'EOF'
feat(sessions): what a card says, and what it refuses to say

The card's group comes from the heading `sessionRows` would have drawn above
it rather than from the session's own fields — the history section, a
finished task's suffix and the localized word for an absent key are already
decided there, and deriving them a second way is how two surfaces start
disagreeing about what a group is called. A fact that was never recorded is
an absent line: a harness that cannot report usage must not show every one
of its sessions costing nothing, in the place a person looks to decide what
to close.

`paneTop` draws a badge whole or not at all — right for a status the pane's
own rows repeat, wrong for the card's group, which nothing else on the card
says. `paneBadgeRoom` is what lets a caller fit such a badge, with the
arithmetic kept where the rule already lives.
EOF
)"
```

---

### Task 3: The band, the pager and the hit test — pure

**Files:**
- Modify: `packages/tui/src/control/sessions.ts`
- Test: `packages/tui/src/control/sessions.test.ts`

**Interfaces:**
- Consumes: `CardGrid` and the `CARD_*` constants from Task 1.
- Produces: `cardBand(o: {listRows: number; header: boolean}): {gridRows: number; pager: boolean}`, `cardAt(grid: CardGrid, x: number, y: number): number | null`, `PagerCells`, `pagerCells(o: {label: string; note: string; width: number}): PagerCells`, `pagerHit(cells: PagerCells, x: number): 'prev' | 'next' | null`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/tui/src/control/sessions.test.ts`; add `cardBand, cardAt, pagerCells, pagerHit` to the import list.

```ts
describe('cardBand', () => {
  // The column header names cells that a card does not have, so its row is reclaimed rather than
  // drawn blank — and the pager is a ROW, which has to be paid for out of the same band or it is
  // composited onto the frame below it.
  it('reclaims the header row and pays for the pager', () => {
    expect(cardBand({ listRows: 18, header: true })).toEqual({ gridRows: 18, pager: true })
    expect(cardBand({ listRows: 18, header: false })).toEqual({ gridRows: 17, pager: true })
  })

  it('gives up the pager before it gives up the grid', () => {
    const tight = cardBand({ listRows: 5, header: false })
    expect(tight.pager).toBe(false)
    expect(tight.gridRows).toBe(5)
  })
})

describe('cardAt', () => {
  const grid = cardGrid({ width: 100, height: 21, total: 10 })!

  it('answers with the card whose own cells were clicked', () => {
    expect(cardAt(grid, 0, 0)).toBe(0)
    expect(cardAt(grid, grid.cardWidth - 1, grid.cardHeight - 1)).toBe(0)
    expect(cardAt(grid, grid.cardWidth + grid.gap, 0)).toBe(1)
    expect(cardAt(grid, 0, grid.cardHeight)).toBe(grid.cols)
  })

  // The gutter between two cards belongs to neither, and a hit test that rounds it into one of them
  // answers a click the user did not make.
  it('answers nothing for the gutter and for the air past the grid', () => {
    expect(cardAt(grid, grid.cardWidth, 0)).toBeNull()
    expect(cardAt(grid, grid.cols * (grid.cardWidth + grid.gap), 0)).toBeNull()
    expect(cardAt(grid, 0, grid.rows * grid.cardHeight)).toBeNull()
    expect(cardAt(grid, -1, 0)).toBeNull()
  })

  it('never answers past the page it drew', () => {
    const small = cardGrid({ width: 200, height: 40, total: 3 })!
    for (let y = 0; y < small.rows * small.cardHeight; y++) {
      for (let x = 0; x < small.cols * (small.cardWidth + small.gap); x++) {
        const hit = cardAt(small, x, y)
        if (hit !== null) expect(hit).toBeLessThan(small.capacity)
      }
    }
  })
})

describe('pagerCells', () => {
  it('keeps the arrows and the page, and gives up the count first', () => {
    const wide = pagerCells({ label: '2 / 5', note: 'showing 6 of 47', width: 40 })
    expect(wide.note).toBe('showing 6 of 47')
    const tight = pagerCells({ label: '2 / 5', note: 'showing 6 of 47', width: 12 })
    expect(tight.note).toBe('')
    expect(tight.label).toBe('2 / 5')
    expect(tight.nextAt).toBeGreaterThan(tight.prevAt)
  })

  // A row wider than the pane wraps, and a wrapped row takes two of the screen's rows while the
  // budget counted one — which pushes everything under it off the bottom.
  it('never draws wider than the row it was measured against', () => {
    for (let w = 0; w <= 60; w++) {
      const c = pagerCells({ label: '10 / 10', note: 'showing 10 of 100', width: w })
      expect(c.width).toBeLessThanOrEqual(w)
    }
  })

  it('resolves a click to the arrow that was drawn there', () => {
    const c = pagerCells({ label: '2 / 5', note: '', width: 20 })
    expect(pagerHit(c, c.prevAt)).toBe('prev')
    expect(pagerHit(c, c.nextAt)).toBe('next')
    expect(pagerHit(c, c.prevAt + 1)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/tui/src/control/sessions.test.ts`
Expected: FAIL — `cardBand is not defined` and the rest.

- [ ] **Step 3: Write the implementation**

Append to `packages/tui/src/control/sessions.ts`:

```ts
// ---------------------------------------------------------------------------
// the card band, its pager, and where a click lands
// ---------------------------------------------------------------------------

/**
 * How the list pane's rows are split between the grid and its pager — PURE.
 *
 * The column HEADER is reclaimed: it names cells (`state`, `task`, `harness`) that a card does not
 * have, so drawing it over a grid would be a heading over nothing. The PAGER is a row like any
 * other and is paid for out of the same band — a row taken without being paid for is composited
 * onto the frame below it, which reads as a corrupted frame rather than a cramped one.
 *
 * The pager is given up before the grid: a page you cannot leave is worse than one you cannot
 * count, and the keys still turn the page.
 */
export function cardBand(o: { listRows: number; header: boolean }): {
  gridRows: number
  pager: boolean
} {
  const available = Math.max(0, o.listRows) + (o.header ? 1 : 0)
  const pager = available >= PANE_FRAME_Y + CARD_MIN_LINES + 1
  return { gridRows: Math.max(0, available - (pager ? 1 : 0)), pager }
}

/**
 * Which card a click landed on, in grid coordinates — PURE, and the SAME arithmetic that drew it.
 *
 * The gutter between two cards belongs to neither: rounding it into one of them answers a click
 * the user did not make, which is worse than not answering at all.
 */
export function cardAt(grid: CardGrid, x: number, y: number): number | null {
  if (x < 0 || y < 0) return null
  const stride = grid.cardWidth + grid.gap
  const col = Math.floor(x / stride)
  if (col >= grid.cols) return null
  if (x - col * stride >= grid.cardWidth) return null
  const row = Math.floor(y / grid.cardHeight)
  if (row >= grid.rows) return null
  const index = row * grid.cols + col
  return index >= grid.capacity ? null : index
}

export interface PagerCells {
  /** `''` when the row is too narrow to carry the arrows at all. */
  prev: string
  next: string
  label: string
  /** How many of how many. The first cell given up. */
  note: string
  /** Column each arrow is drawn at, or `-1` when it is not drawn. */
  prevAt: number
  nextAt: number
  /** What the row actually occupies — never more than the width it was measured against. */
  width: number
}

/** The glyphs, so the drawn row and the hit test cannot disagree about their width. */
const PAGER_PREV = '‹'
const PAGER_NEXT = '›'

/**
 * The pager row, fitted — PURE.
 *
 * Cells are given up in the order the row can afford to lose them: the COUNT first (the page label
 * already says where you are), then the arrows (the keys still work, and the footer names them),
 * and the page label last — a pager that cannot say which page this is has stopped being a pager.
 */
export function pagerCells(o: { label: string; note: string; width: number }): PagerCells {
  const width = Math.max(0, o.width)
  const none: PagerCells = {
    prev: '', next: '', label: '', note: '', prevAt: -1, nextAt: -1, width: 0,
  }
  if (width === 0) return none

  const arrows = 4 + o.label.length // "‹ label ›"
  if (arrows <= width) {
    const nextAt = 2 + o.label.length + 1
    const noteAt = nextAt + 3
    const withNote = noteAt + o.note.length <= width && o.note !== ''
    return {
      prev: PAGER_PREV, next: PAGER_NEXT, label: o.label,
      note: withNote ? o.note : '',
      prevAt: 0, nextAt,
      width: withNote ? noteAt + o.note.length : arrows,
    }
  }
  const label = o.label.length <= width ? o.label : o.label.slice(0, width)
  return { ...none, label, width: label.length }
}

/** Which arrow a click landed on, resolved against the very cells that were drawn. */
export function pagerHit(cells: PagerCells, x: number): 'prev' | 'next' | null {
  if (cells.prev !== '' && x === cells.prevAt) return 'prev'
  if (cells.next !== '' && x === cells.nextAt) return 'next'
  return null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/tui/src/control/sessions.test.ts`
Expected: PASS.

- [ ] **Step 5: Type check and commit**

```bash
bun tsc --noEmit
git add packages/tui/src/control/sessions.ts packages/tui/src/control/sessions.test.ts
git commit -m "$(cat <<'EOF'
feat(sessions): the card band pays for its pager and answers the mouse

The pager is a row, so it comes out of the band rather than out of the frame
below it — a row taken without being paid for is composited onto the rows
under it, which reads as a corrupted frame rather than a cramped one. The
column header is reclaimed instead of drawn: it names cells a card does not
have. And the hit test is the same arithmetic that placed the cards, with
the gutter between two of them belonging to neither, because rounding it
into one answers a click nobody made.
EOF
)"
```

---

### Task 4: The switch — preferences, strings, and the menu section

**Files:**
- Modify: `packages/tui/src/control/types.ts:389-458` (`SessionViewPrefs`, `DEFAULT_SESSION_VIEW`)
- Modify: `packages/server/server/preferences.ts:67-78` (the `sessionView` mirror)
- Modify: `packages/tui/src/control/sessions.ts` (`AsideRow`, `asideRows`, `asideRowKey`)
- Modify: `packages/tui/src/control/i18n.ts` (the interface plus BOTH tables)
- Test: `packages/tui/src/control/sessions.test.ts`

**Interfaces:**
- Consumes: `SessionLayout` (Task 1).
- Produces: the `{ kind: 'layout'; value: SessionLayout; label: string; on: boolean }` aside row; `asideRows` gains a required `layout: { heading: string; words: Record<SessionLayout, string>; value: SessionLayout }` option; `SessionViewPrefs.layout` and `SessionViewPrefs.cardAnchor`; the strings `asideLayout`, `sessionsLayouts`, `sessionsPage`, `sessionsShowing`, `sessionsCardAttached`, `sessionsCardBlind`, `keySessionsLayout`, `keySessionsCard`, `keySessionsPage`.

- [ ] **Step 1: Write the failing test**

Append to `packages/tui/src/control/sessions.test.ts`. The file already builds an `asideRows({...})` argument in its aside `describe` — copy that call and add the new `layout` option rather than inventing a second fixture.

```ts
describe('asideRows — the layout section', () => {
  // Reuse the existing aside fixture in this file; it is called `asideArgs` in the aside describe.
  // If that helper is not in scope here, copy its object literal and add `layout` to it.
  const rowsFor = (value: 'list' | 'cards') => asideRows({ ...asideArgs, layout: {
    heading: 'LAYOUT', words: { list: 'list', cards: 'cards' }, value,
  } })

  it('offers both layouts and marks the one in force', () => {
    const rows = rowsFor('cards').filter(r => r.kind === 'layout')
    expect(rows).toHaveLength(2)
    expect(rows.map(r => (r as { value: string }).value)).toEqual(['list', 'cards'])
    expect(rows.map(r => (r as { on: boolean }).on)).toEqual([false, true])
  })

  // The cursor is a NAME, not a position: the menu is rebuilt on every poll, and an index would be
  // pointing at a different row by the next one.
  it('keys a layout row by what it selects', () => {
    const row = rowsFor('list').find(r => r.kind === 'layout')!
    expect(asideRowKey(row)).toBe('layout:list')
  })

  it('lets the cursor land on a layout row', () => {
    const rows = rowsFor('list')
    const index = rows.findIndex(r => r.kind === 'layout')
    expect(asideSelectable(rows)).toContain(index)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/tui/src/control/sessions.test.ts`
Expected: FAIL — TypeScript rejects the unknown `layout` option, or the filter finds no `layout` rows.

- [ ] **Step 3: Add the aside row**

In `packages/tui/src/control/sessions.ts`, add to the `AsideRow` union (right after the `group` member):

```ts
  /** One LAYOUT the list can be drawn in, and whether it is the one in force. */
  | { kind: 'layout'; value: SessionLayout; label: string; on: boolean }
```

Add to `asideRows`'s options object, right after `groupWords`:

```ts
  /**
   * The layout block.
   *
   * Its own section rather than two more rows among the groupings: "list or cards" and "grouped by
   * what" are different questions, and six grouping rows with two unlike ones among them is a menu
   * nobody reads correctly.
   */
  layout: { heading: string; words: Record<SessionLayout, string>; value: SessionLayout }
```

Inside `asideRows`, immediately after the actions loop and BEFORE the `view` heading is pushed:

```ts
  rows.push({ kind: 'rule' }, { kind: 'heading', label: o.layout.heading })
  for (const value of ['list', 'cards'] as const) {
    rows.push({
      kind: 'layout', value, label: o.layout.words[value], on: value === o.layout.value,
    })
  }
```

Add to `asideRowKey`'s switch, beside the `group` case:

```ts
    case 'layout': return `layout:${row.value}`
```

- [ ] **Step 4: Add the persisted fields**

In `packages/tui/src/control/types.ts`, add to `SessionViewPrefs` (after `hideDetail`):

```ts
  /**
   * How the fleet is ARRANGED — a list of rows, or a grid of cards.
   *
   * Absent reads as `DEFAULT_SESSION_VIEW.layout`, never as a literal: a fallback written by hand
   * once turned the strict filter off on every machine that already had a `preferences.json`, and
   * the persist effect then wrote that off to disk, making it permanent.
   */
  layout?: 'list' | 'cards'
  /**
   * WHICH PAGE of cards was open, named by the SESSION at the top of it rather than by a number.
   *
   * The fleet re-sorts every five seconds, so "page 2" is a position and a position is not an
   * identity — by the next poll it holds different sessions. The same rule `asideRowKey` follows
   * for the menu cursor. An anchor that is no longer in the list simply opens page 0.
   */
  cardAnchor?: string
```

And to `DEFAULT_SESSION_VIEW`, after `onlyActive: true,`:

```ts
  layout: 'list',
```

In `packages/server/server/preferences.ts`, mirror both inside `sessionView` (after `marked?: string[]`):

```ts
    /** How the fleet is arranged — a list of rows, or a grid of cards. */
    layout?: 'list' | 'cards'
    /** The session at the top of the open card page: a page number would name other sessions by
     *  the next poll, so the page is remembered by identity. */
    cardAnchor?: string
```

- [ ] **Step 5: Add the strings**

In `packages/tui/src/control/i18n.ts`, add to the `ControlStrings` interface beside the other sessions entries:

```ts
  /** The menu's layout section, and what the two layouts are called. */
  asideLayout: string
  sessionsLayouts: Record<'list' | 'cards', string>
  /** The card pager: which page, and how much of the fleet is on it. */
  sessionsPage: (page: number, pages: number) => string
  sessionsShowing: (shown: number, total: number) => string
  /** Card markers — said on the state line, where a row has no room for them. */
  sessionsCardAttached: string
  sessionsCardBlind: string
  keySessionsLayout: string
  keySessionsCard: string
  keySessionsPage: string
```

EN table:

```ts
  asideLayout: 'LAYOUT',
  sessionsLayouts: { list: 'list', cards: 'cards' },
  sessionsPage: (page, pages) => `${page} / ${pages}`,
  sessionsShowing: (shown, total) => `${shown} of ${total}`,
  sessionsCardAttached: 'attached',
  sessionsCardBlind: 'approval unknown',
  keySessionsLayout: 'f list/cards',
  keySessionsCard: '←→ card',
  keySessionsPage: 'pgup/pgdn page',
```

PT table:

```ts
  asideLayout: 'FORMATO',
  sessionsLayouts: { list: 'lista', cards: 'cards' },
  sessionsPage: (page, pages) => `${page} / ${pages}`,
  sessionsShowing: (shown, total) => `${shown} de ${total}`,
  sessionsCardAttached: 'anexada',
  sessionsCardBlind: 'aprovação incerta',
  keySessionsLayout: 'f lista/cards',
  keySessionsCard: '←→ card',
  keySessionsPage: 'pgup/pgdn página',
```

- [ ] **Step 6: Make `Sessions.tsx` compile again**

`asideRows` now requires `layout`. In `packages/tui/src/control/tabs/Sessions.tsx`, inside the `asideList` `useMemo` call, add after `groupWords: s.sessionsGroupings,`:

```ts
    layout: { heading: s.asideLayout, words: s.sessionsLayouts, value: layout },
```

and add a `layout` state above it (the full wiring lands in Task 5; this is what makes the module compile):

```ts
  const [layout, setLayout] = useState<SessionLayout>(
    view?.layout ?? DEFAULT_SESSION_VIEW.layout ?? 'list',
  )
```

Import `SessionLayout` from `../sessions` in the existing import block. In `runAside`, handle the new row beside the `group` case:

```ts
    if (row.kind === 'layout') { setLayout(row.value); return }
```

In `AsideMenu`, the `dot` and `label` expressions already cover any row with `on` and `label`, so no change is needed there — verify by reading them rather than assuming.

- [ ] **Step 7: Run the tests and the type check**

Run: `bun test packages/tui/src/control/sessions.test.ts && bun tsc --noEmit`
Expected: PASS, no type errors. `setLayout` is unused until Task 5 — if the lint config rejects that, wire the `f` key from Task 5 Step 4 now rather than adding a suppression.

- [ ] **Step 8: Commit**

```bash
git add packages/tui/src/control/sessions.ts packages/tui/src/control/sessions.test.ts \
        packages/tui/src/control/types.ts packages/tui/src/control/i18n.ts \
        packages/tui/src/control/tabs/Sessions.tsx packages/server/server/preferences.ts
git commit -m "$(cat <<'EOF'
feat(sessions): a layout section in the menu, and a page remembered by name

"List or cards" and "grouped by what" are different questions, so the layout
gets its own numbered section rather than two unlike rows among six grouping
ones. The open page is stored as the id of the session at the top of it: the
fleet re-sorts every five seconds, so a page number names different sessions
by the next poll — the same reason the menu cursor is a name and not an
index.
EOF
)"
```

---

### Task 5: Draw the cards

**Files:**
- Modify: `packages/tui/src/control/tabs/Sessions.tsx`
- Modify: `packages/tui/scripts/preview.tsx:376-434` (the fleet fixture)

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: the rendered grid. No new exports.

- [ ] **Step 1: Give the preview something to draw**

In `packages/tui/scripts/preview.tsx`, add `lastLines` to two fixture sessions so the `say` line is exercised, and leave the ones without usage as they are (they are the empty case the card must not fill with a zero). In the `a1b2c3` entry add:

```ts
      lastLines: ['applying migration 003_auth_store.sql', 'waiting for your approval'],
```

and in the `778899` entry add:

```ts
      lastLines: ['rewriting src/importer/rows.ts'],
      note: 'blocked on the CSV encoding',
```

- [ ] **Step 2: Add the imports and the derived values**

In `packages/tui/src/control/tabs/Sessions.tsx`, extend the existing `from '../sessions'` import with:

```ts
  cardGrid, cardPage, cardBadges, cardLines, fitCardLines, cardStateCells, cardBand,
  cardAt, pagerCells, pagerHit, CARD_PAGE_MAX,
  type CardGrid, type CardLine, type SessionLayout,
```

After the `rows` / `selectable` memos, add:

```ts
  // The cards are the SAME sequence the list draws, headings removed — so `at` (an index into
  // `selectable`) names the same session in both layouts, and switching layout keeps the selection.
  const cards = useMemo(
    () => rows.flatMap(r => (r.kind === 'session' ? [r.session] : [])),
    [rows],
  )
  const badges = useMemo(() => cardBadges(rows), [rows])
```

- [ ] **Step 3: Suppress the detail pane in cards mode**

Replace the `detailWanted` line with:

```ts
  // A card holds what the detail pane holds, so in cards mode the pane is not asked for at all and
  // the whole band goes to the grid — a fleet drawn twice on one screen is half a screen wasted. A
  // QUESTION still gets its rows, switch or no switch: a prompt with nowhere to draw cannot be
  // answered.
  const detailWanted = ask
    ? Math.max(QUESTION_ROWS, detail.length)
    : layout === 'cards' || hideDetail ? 0 : detail.length
```

- [ ] **Step 4: The `f` key and the grid's own navigation**

In the `useInput` handler, beside the other letters (after the `if (input === 'd') …` line):

```ts
    if (input === 'f') { setLayout(l => (l === 'list' ? 'cards' : 'list')); return }
```

And immediately BEFORE the final `if (selectable.length > 0) { … }` block:

```ts
    // A grid has two axes, so the arrows mean what they mean in a grid: `←`/`→` step one card,
    // `↑`/`↓` step a whole row of them. The list's own reducer wraps a single column, which in a
    // grid would send the cursor from the top-left card to the bottom-RIGHT one.
    if (grid && selectable.length > 0) {
      const here = Math.max(0, at)
      const to = (n: number) => setCursor(Math.max(0, Math.min(n, selectable.length - 1)))
      if (key.leftArrow) return to(here - 1)
      if (key.rightArrow) return to(here + 1)
      if (key.upArrow || input === 'k') return to(here - grid.cols)
      if (key.downArrow || input === 'j') return to(here + grid.cols)
      // The page is always the one holding the cursor, so turning a page IS moving the cursor —
      // there is no second position to keep in sync with the first.
      if (key.pageUp) return to(here - grid.capacity)
      if (key.pageDown) return to(here + grid.capacity)
      if (key.home || input === 'g') return to(0)
      if (key.end || input === 'G') return to(selectable.length - 1)
      return
    }
```

- [ ] **Step 5: Compute the grid — BEFORE the input handlers that read it**

Immediately after the `const cockpit = actionRows === 0 ? probe : sessionsCockpit({…})` assignment
(roughly `Sessions.tsx:412`), and NOT down beside `listBody`: `useInput` and `usePointer` both close
over `grid`, and a value declared after them reads as "used before its declaration" to anyone
editing this file even though the closures run late. The layout arithmetic belongs together and
above the handlers that consume it.

Add there:

```ts
  // No scrollbar in cards mode — the pager is what says where you are — so the grid is measured
  // against the pane's full body.
  const cardsBody = paneBody(cockpit.list)
  const band = cardBand({ listRows: cockpit.listRows, header: cockpit.header })
  // `null` on a terminal too small for one whole card, and the list is drawn instead: the same
  // degradation the aside menu makes when it is dropped rather than squeezed.
  const grid: CardGrid | null = layout === 'cards' && rows.length > 0
    ? cardGrid({ width: cardsBody, height: band.gridRows, total: cards.length })
    : null
  const page = grid ? cardPage(cards.length, grid.capacity, Math.floor(Math.max(0, at) / grid.capacity)) : null
  const pager = grid && band.pager
    ? pagerCells({
        label: s.sessionsPage(page!.page + 1, page!.pages),
        note: s.sessionsShowing(page!.to - page!.from, cards.length),
        width: cardsBody,
      })
    : null
```

- [ ] **Step 6: Draw the grid instead of the rows**

In the list `Pane`, the final branch of the `fleet === undefined ? … : rows.length === 0 ? … : (…)` chain is the list body. Wrap it so the grid takes over when there is one — replace the opening of that last branch with:

```tsx
      ) : grid ? (
        <Box flexDirection="column" width={cardsBody} flexShrink={0}>
          {Array.from({ length: grid.rows }, (_, r) => (
            <Box key={`row${r}`} flexDirection="row" height={grid.cardHeight} flexShrink={0}>
              {Array.from({ length: grid.cols }, (_, c) => {
                const slot = r * grid.cols + c
                const index = page!.from + slot
                const session = slot < grid.capacity ? cards[index] : undefined
                return (
                  <Box key={`col${c}`} flexDirection="row" flexShrink={0}>
                    {c > 0 ? <Box width={grid.gap} flexShrink={0} /> : null}
                    {session ? (
                      <SessionCard
                        session={session}
                        badge={badges[index] ?? ''}
                        selected={selected?.id === session.id}
                        marked={marked.has(session.id)}
                        width={grid.cardWidth}
                        height={grid.cardHeight}
                        strings={s}
                      />
                    ) : (
                      // An empty cell keeps the grid's shape without drawing a frame around
                      // nothing — a card with no session in it is a box claiming to be one.
                      <Box width={grid.cardWidth} height={grid.cardHeight} flexShrink={0} />
                    )}
                  </Box>
                )
              })}
            </Box>
          ))}
          {pager ? <Pager cells={pager} /> : null}
        </Box>
      ) : (
```

(the existing list body follows unchanged, ending with its `</Box>` and `)`).

- [ ] **Step 7: Write the two new components**

Append to `packages/tui/src/control/tabs/Sessions.tsx`, after `SessionRowView`:

```tsx
/**
 * One session as a card — the same `Pane` every other framed region of this app uses.
 *
 * The frame's title is the HANDLE, because `agentop session attach 3f5f` takes a prefix and that is
 * the one thing on the card naming this session to anything but this screen; the badge is the GROUP,
 * so a card read on its own is never ambiguous about which project or task it belongs to.
 *
 * The lines come from the pure `cardLines`, cut from the bottom by `fitCardLines`, so what the card
 * gives up on a short terminal is decided in one place and tested there.
 */
function SessionCard({ session, badge, selected, marked, width, height, strings: s }: {
  session: ControlSession
  badge: string
  selected: boolean
  marked: boolean
  width: number
  height: number
  strings: ControlStrings
}) {
  const inner = paneBody(width)
  const lines = fitCardLines(
    cardLines(session, {
      attached: s.sessionsCardAttached,
      blind: s.sessionsCardBlind,
      // The clock arithmetic happens HERE, not in the pure module: the card repaints far more often
      // than the poll runs, so a duration computed upstream would freeze at whatever it was.
      ago: startedAt => s.sessionsAgo(Math.max(0, Math.round((Date.now() - startedAt) / 1000))),
    }),
    paneRows(height),
  )
  const handle = sessionHandle(session) || session.harness

  return (
    <Pane
      title={handle}
      // Fitted HERE rather than left to `paneTop`, whose badge rule is whole-or-nothing: the group
      // is the only place a card says which project or task it belongs to, so it is truncated
      // rather than dropped. `paneBadgeRoom` is that frame's own arithmetic.
      badge={truncate(badge, paneBadgeRoom(handle, width))}
      focused={selected}
      width={width}
      height={height}
    >
      {lines.map(line => <CardLineView key={line.key} line={line} width={inner} marked={marked} selected={selected} />)}
    </Pane>
  )
}

/** One line of a card. The state keeps its colour and its WORD, exactly as the row does. */
function CardLineView({ line, width, marked, selected }: {
  line: CardLine
  width: number
  marked: boolean
  selected: boolean
}) {
  if (line.kind === 'state') {
    const cells = cardStateCells(line.text, line.tail ?? '', width)
    return (
      <Text wrap="truncate">
        <Text color={STATE_COLOR[/* the session's own state is carried by the word's colour */ 'working']}>{''}</Text>
        <Text>{cells.state}</Text>
        <Text dimColor>{cells.tail}</Text>
      </Text>
    )
  }
  if (line.kind === 'title') {
    return (
      <Text wrap="truncate" color={selected ? COLORS.accent : marked ? COLORS.info : undefined} bold>
        {truncate(line.text, width)}
      </Text>
    )
  }
  // What the assistant said is drawn in the text colour: it is the content, and every other line is
  // a label for it.
  return (
    <Text wrap="truncate" color={line.kind === 'say' ? COLORS.text : COLORS.secondary}>
      {truncate(line.text, width)}
    </Text>
  )
}

/** Which page, how much of the fleet is on it, and the two arrows that move it. */
function Pager({ cells }: { cells: PagerCells }) {
  return (
    <Text wrap="truncate">
      <Text color={COLORS.accent}>{cells.prev ? `${cells.prev} ` : ''}</Text>
      <Text bold>{cells.label}</Text>
      <Text color={COLORS.accent}>{cells.next ? ` ${cells.next}` : ''}</Text>
      <Text dimColor>{cells.note ? `   ${cells.note}` : ''}</Text>
    </Text>
  )
}
```

**Fix the state colour before running anything:** the `CardLineView` above cannot know the session's state from a `CardLine`. Give `CardLine` no new field — pass the colour down instead. Change `SessionCard`'s map to:

```tsx
      {lines.map(line => (
        <CardLineView
          key={line.key}
          line={line}
          width={inner}
          marked={marked}
          selected={selected}
          stateColor={STATE_COLOR[session.state]}
          bold={session.state === 'waiting-approval'}
        />
      ))}
```

and `CardLineView`'s signature and state branch to:

```tsx
function CardLineView({ line, width, marked, selected, stateColor, bold }: {
  line: CardLine
  width: number
  marked: boolean
  selected: boolean
  stateColor: string | undefined
  bold: boolean
}) {
  if (line.kind === 'state') {
    const cells = cardStateCells(line.text, line.tail ?? '', width)
    return (
      <Text wrap="truncate">
        <Text color={stateColor} bold={bold}>{cells.state}</Text>
        <Text dimColor>{cells.tail}</Text>
      </Text>
    )
  }
  …
```

Add `PagerCells` to the `from '../sessions'` type imports, and `paneBadgeRoom` to the existing
`from '../chrome.ts'` import.

- [ ] **Step 8: Verify with the preview at four widths and four heights**

```bash
for w in 60 90 130 190; do for h in 12 20 30 44; do
  bun packages/tui/scripts/preview.tsx --screen sessions --cols $w --rows $h --lang pt --keys f | tail -2
done; done
```

Expected: every line reports `✓ every row fits N columns`. Any `✗` is a layout bug — fix it in the pure module, not in the component.

Look at one frame in full and confirm the cards are readable:

```bash
bun packages/tui/scripts/preview.tsx --screen sessions --cols 130 --rows 40 --lang pt --keys f
```

- [ ] **Step 9: Run the full suite, type check, and commit**

```bash
bun tsc --noEmit && bun test
git add packages/tui/src/control/tabs/Sessions.tsx packages/tui/scripts/preview.tsx
git commit -m "$(cat <<'EOF'
feat(sessions): draw the fleet as cards

A row is the right shape for scanning forty sessions and the wrong shape for
reading one: what a session is saying, its model and the note left on it
lived in the detail pane, one selection at a time. A card carries them
together — which is why cards mode does not ask for the detail pane at all
and gives the whole band to the grid, rather than drawing the same fleet
twice on one screen.
EOF
)"
```

---

### Task 6: The keyboard's other half, the mouse, and the remembered page

**Files:**
- Modify: `packages/tui/src/control/tabs/Sessions.tsx`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: nothing new; wires `cardAnchor` through the existing `onView` effect.

- [ ] **Step 1: Remember the page by the session at the top of it**

Add beside the other state declarations:

```ts
  /**
   * The session at the top of the open card page.
   *
   * The page itself is DERIVED from the cursor, so there is no second position to keep in sync —
   * but it still has to survive a restart, and a page NUMBER would name different sessions by the
   * next poll. Held in state rather than read back off `view`, so switching to the list and back
   * does not lose the page.
   */
  const [cardAnchor, setCardAnchor] = useState<string | undefined>(view?.cardAnchor)
```

After the `page` computation from Task 5 Step 5:

```ts
  // Updated only when the PAGE changes, never on every cursor move: `setSessionView` writes
  // `preferences.json` to disk, and a disk write per arrow key is not a thing this screen may do.
  const pageAnchor = page ? cards[page.from]?.id : undefined
  useEffect(() => {
    if (pageAnchor && pageAnchor !== cardAnchor) setCardAnchor(pageAnchor)
  }, [pageAnchor, cardAnchor])
```

Add `layout` and `cardAnchor` to the persist effect's payload and to its dependency array:

```ts
      hideDetail,
      layout,
      ...(cardAnchor ? { cardAnchor } : {}),
```

- [ ] **Step 2: Restore the layout and the anchor**

In the `restored` effect, add beside the other restores:

```ts
    setLayout(view.layout ?? DEFAULT_SESSION_VIEW.layout ?? 'list')
    setCardAnchor(view.cardAnchor)
```

The anchor cannot be applied there — the fleet has not arrived yet. Add its own one-shot effect below:

```ts
  /**
   * Put the cursor back on the remembered page, ONCE, when the fleet finally arrives.
   *
   * Separate from the arrangement restore because it needs a different thing to have loaded: the
   * arrangement comes from the host's status, the anchor can only be resolved against the sessions.
   * An anchor no longer in the list — the session ended, a filter changed, the machine is another
   * one — simply leaves the cursor where it is, which is page 0.
   */
  const anchored = useRef(false)
  useEffect(() => {
    if (anchored.current || cards.length === 0 || !view?.cardAnchor) return
    anchored.current = true
    const index = cards.findIndex(v => v.id === view.cardAnchor)
    if (index >= 0) setCursor(index)
  }, [cards, view?.cardAnchor])
```

Add `layout: DEFAULT_SESSION_VIEW.layout ?? 'list'` to `resetView` — `ctrl+r` restores how the app opens on a fresh machine, and a layout left behind by the reset is the one setting that would survive it:

```ts
    setLayout(DEFAULT_SESSION_VIEW.layout ?? 'list')
```

- [ ] **Step 3: Answer the mouse**

In the `usePointer` handler, replace the body of the `if (inPane(listX, cockpit.list, 0, cockpit.band))` branch's row resolution so the grid is answered when there is one. Immediately after `setActionsFocused(false)` and `const y = p.y - 1`, before the summary check stays as it is, add — after the summary branch:

```ts
      if (grid) {
        // Resolved against the very grid that drew the cards: the pane's frame, the summary row
        // and, in the pager's case, the row it sits on are all paid for here rather than assumed.
        const gy = y - (cockpit.summary ? 1 : 0)
        const gx = p.x - listX - PANE_EDGE_X
        if (pager && gy === grid.rows * grid.cardHeight) {
          const hit = pagerHit(pager, gx)
          if (hit && page) {
            const step = hit === 'next' ? grid.capacity : -grid.capacity
            setCursor(c => Math.max(0, Math.min(Math.max(0, c) + step, selectable.length - 1)))
          }
          return
        }
        const slot = cardAt(grid, gx, gy)
        if (slot === null || !page) return
        const index = page.from + slot
        if (index < selectable.length) setCursor(index)
        return
      }
```

- [ ] **Step 4: Say which keys work**

In the `onChrome` effect's final (list-focused) branch, make the hint list depend on the layout:

```ts
            hints: [
              s.keyQuit, s.keyTabsAlt, s.keySessionsActions, s.keyAsideSection,
              s.keySessionsAttach,
              // The footer must describe the keys that work HERE. In a grid the arrows have two
              // axes and the page keys exist; in the list neither is true, and a hint for a key
              // that does nothing is the one bug this footer exists to prevent.
              ...(grid ? [s.keySessionsCard, s.keySessionsPage] : [s.keyMove]),
              s.keySessionsLayout,
              s.keySessionsSearch, s.keySessionsNew, s.keySessionsGroup, s.keySessionsClosed,
              ...(grouping === 'task' ? [s.keySessionsNoTask] : []),
              s.keySessionsReset,
            ],
```

Add `grid` to that effect's dependency array — it must be a stable value there, so pass `Boolean(grid)` into the array rather than the object:

```ts
  }, [isActive, onChrome, s, ask, actionsFocused, focus, cockpit.aside, grouping, Boolean(grid)])
```

- [ ] **Step 5: Verify by driving the app**

```bash
# the toggle, then a page turn, then back to the list
bun packages/tui/scripts/preview.tsx --screen sessions --cols 130 --rows 40 --lang pt --keys f,right,right,pgdn | tail -3
bun packages/tui/scripts/preview.tsx --screen sessions --cols 130 --rows 40 --lang en --keys f,f | tail -3
# the menu's new section, reached by its number
bun packages/tui/scripts/preview.tsx --screen sessions --cols 130 --rows 40 --lang en --keys 2
```

Expected: `✓ every row fits` on each, the footer naming `←→ card` and `pgup/pgdn page` only while the cards are up, and the menu's section 2 titled `layout` with a dot on the layout in force.

- [ ] **Step 6: Run everything and commit**

```bash
bun tsc --noEmit && bun test
git add packages/tui/src/control/tabs/Sessions.tsx
git commit -m "$(cat <<'EOF'
feat(sessions): move through the cards, and come back to the page you left

The page is derived from the cursor rather than held beside it, so turning a
page IS moving the cursor and there is no second position to keep in sync.
What survives a restart is the session at the TOP of the page, not the page
number: the fleet re-sorts every five seconds, so a number names other
sessions by the next poll. The footer names the grid's keys only while the
grid is up — a hint for a key that does nothing is the one bug that footer
exists to prevent.
EOF
)"
```

---

### Task 7: The sweep, the docs, and the pull request

**Files:**
- Modify: `CLAUDE.md` (the `packages/tui` rules section)
- Modify: `docs/session-manager.md` (only if it describes the sessions screen's layout — check first)

- [ ] **Step 1: Run the full width and height sweep, both languages**

```bash
for lang in en pt; do for w in 60 90 130 190; do for h in 12 20 30 44; do
  printf '%s %sx%s ' "$lang" "$w" "$h"
  bun packages/tui/scripts/preview.tsx --screen sessions --cols $w --rows $h --lang $lang --keys f | tail -1
done; done; done
```

Expected: every line ends in `✓ every row fits`. Also check the questions still draw over a grid:

```bash
bun packages/tui/scripts/preview.tsx --screen sessions --cols 130 --rows 40 --lang pt --keys f,x | tail -3
```

Expected: `✓`, and the kill confirmation visible under the grid.

- [ ] **Step 2: Write the rule down**

Add to `CLAUDE.md`, in the `## Terminal UI (packages/tui)` → `### Rules` list, after the sessions-tab bullet:

```markdown
- **The sessions tab has two LAYOUTS, and the card grid is paginated rather than scrolled.** `f`
  swaps the list for a grid of cards (`cardGrid`, `sessions.ts`), one card per session, drawn with
  the same `Pane` as every other framed region. Ten to a page is a CAP, never a size: at 130x30 the
  pane carries six, and a fixed ten would have to scroll INSIDE the page — two mechanisms for
  reaching one card. So the page is what the grid can show, the grid is shaped by the FLEET (a 6x2
  grid holding three sessions is three cards and nine holes), and `cardGrid` returns `null` on a
  terminal too small for one whole card, where the list is drawn instead. Cards mode does not ask
  for the detail pane at all — a card carries what that pane carried, and drawing the same fleet
  twice wastes half a screen. **The remembered page is the id of the session at the top of it**
  (`SessionViewPrefs.cardAnchor`), never a page number: the fleet re-sorts every five seconds, so a
  position names different sessions by the next poll — the same rule `asideRowKey` follows for the
  menu cursor. The page is DERIVED from the cursor, so turning a page is moving the cursor and
  there is no second position to keep in sync.
```

- [ ] **Step 3: Commit the docs**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(sessions): the two rules the card layout is built on

Ten to a page is a cap and not a size, and the remembered page is a session
rather than a number. Both are the kind of thing a later change quietly
undoes — a fixed page size reintroduces scrolling inside a page, and a
stored page index looks obviously simpler right up until the fleet re-sorts.
EOF
)"
```

- [ ] **Step 4: Push and open the pull request against `dev`**

```bash
rtk proxy git push -u origin feat/session-cards
rtk proxy git ls-remote --heads origin feat/session-cards   # confirm the push actually happened
gh pr create --base dev --title "feat(sessions): a card layout beside the list" --body "$(cat <<'EOF'
## What

A second layout for the cockpit's sessions pane: `f` swaps the list of rows for a grid of cards, at
most ten to a page.

## Why

The row is the right shape for scanning forty sessions and the wrong shape for reading one.
Everything needed to decide what to do with a session — what it is saying right now, its model, the
note left on it, how long it has been going — lived in the detail pane, one selection at a time.

## The three decisions worth reviewing

- **Ten is a cap, not a page size.** Ten cards rarely fit (at 130x30 the pane carries six), and a
  fixed ten would have to scroll INSIDE the page — two mechanisms for reaching one card. The page is
  what the grid can actually show.
- **The remembered page is a session id, not a number.** The fleet re-sorts every five seconds, so a
  stored page index names different sessions by the next poll. Same rule the menu cursor follows.
- **Cards mode does not draw the detail pane.** A card carries what that pane carried; the whole
  band goes to the grid instead of drawing the same fleet twice.

## Verification

- `bun tsc --noEmit` clean, `bun test` green.
- `packages/tui/scripts/preview.tsx --screen sessions --keys f` swept over widths 60/90/130/190 and
  heights 12/20/30/44 in both languages: every frame reports `✓ every row fits`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01RZuiK9ffPxXvNKDoHcmBBd
EOF
)"
```

Do NOT merge. Report the PR number.

---

## Self-review notes

- Spec coverage: layout switch (Task 4 menu + Task 5 key), card content (Task 2), pagination at ten
  (Task 1), grouping stated on the card (Task 2 `cardBadges`), navigation (Task 5 Step 4),
  mouse (Task 6 Step 3), persistence (Tasks 4 and 6), i18n both tables (Task 4 Step 5), preview
  sweep (Tasks 5 and 7), docs (Task 7).
- `truncateCell` is module-private in `sessions.ts` and already defined above the new code — Task 2's
  `cardStateCells` uses it without a new import.
- `paneBody` / `paneRows` / `Pane` / `truncate` / `COLORS` / `STATE_COLOR` are all already imported
  in `Sessions.tsx`; `PANE_EDGE_X` is already defined there.
