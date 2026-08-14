# Session cards — a second layout for the cockpit's fleet list

**Date:** 2026-08-13
**Scope:** `packages/tui/src/control/{sessions.ts,tabs/Sessions.tsx,i18n.ts,types.ts}`,
`packages/server/server/preferences.ts`

## The problem

The sessions pane draws one row per session: handle, state, name, worktree, task, usage, harness,
project. The row is measured and aligned, and it is the right shape for scanning forty sessions —
but it is the wrong shape for reading one. Everything a person needs in order to decide what to do
with a session (what it is saying right now, which model it runs, the note they left on it, how long
it has been going) lives in the detail pane, one selection at a time.

A card layout answers the second question without giving up the first: the same fleet, arranged as a
grid of small framed blocks, each holding what a row cannot carry.

## What is being built

A LAYOUT switch on the sessions pane — `list` (what exists) or `cards` (new) — with the card grid
paginated at most ten to a page, the mode and the page remembered across restarts.

## Decisions and why

### 1. The page is what the grid holds, capped at ten

Ten cards rarely fit: at 130x30 the list pane's body is roughly 96 columns by 12 rows, which carries
a 3x2 grid of five-line cards — six. A fixed page of ten would then need to scroll INSIDE the page,
which is two mechanisms for one thing: the reader would page and scroll to reach the same card.

So the page holds `min(cols * rows, 10)`. One mechanism, no hidden card, no compositing risk, and on
a terminal that can carry ten the page is exactly ten.

The consequence is deliberate: "page 2" means different things at different terminal sizes. That is
already true of every windowed list in this application.

### 2. Pagination is the CARD layout's mechanism, never the list's

The list scrolls, with the tested `scrollBar` and `windowOffset` it already has. It keeps them.
Adding pages to the list would replace a working, shipped behaviour to make two layouts match, and
the match is not worth the change.

### 3. The remembered page is a SESSION, never a number

`SessionViewPrefs` gains `cardAnchor?: string` — the id of the FIRST card of the current page.

A stored page NUMBER points at different sessions on every poll: the fleet re-sorts every five
seconds, so "page 2" is a position and a position is not an identity. This is the same rule
`asideRowKey` / `resolveAsideCursor` follow for the menu cursor, applied to paging.

On restore the anchor is looked up; found, the page is the one holding it; absent — the session
ended, the filters changed, the machine is another one — the page is 0. It is WRITTEN only when the
page changes, not on every cursor move: `setSessionView` writes `preferences.json` to disk, and a
disk write per arrow key is not a thing this screen may do.

### 4. A card's group comes from the SAME heading the list would draw

`sessionRows` already flattens the groups into headings, spacers and session rows, including its own
"history" section for closed conversations. A card's badge is the label of the heading that precedes
it in exactly that list. Deriving it a second way — from `s.task`, `s.repo`, the grouping key — is a
second implementation of the grouping, and the two would disagree the first time a rule changed
(the closed section, a finished task's ` · finished` suffix, an absent key's localized word).

With grouping off there is no heading, and the badge is the session's project — never blank air.

## The architecture

Everything that decides a width, a height, a count or a hit lives in the pure `sessions.ts`; the
component draws what the module decided. This is the rule the file already states, and it exists
because a row one column too wide shears every row under it and a screen that draws past its
`height` is COMPOSITED by Ink rather than clipped.

### New pure surface (`packages/tui/src/control/sessions.ts`)

```ts
export type SessionLayout = 'list' | 'cards'
export const CARD_PAGE_MAX = 10

export interface CardGrid {
  cols: number         // cards across
  rows: number         // rows of cards
  cardWidth: number    // columns per card, FRAME INCLUDED
  cardHeight: number   // rows per card, FRAME INCLUDED
  capacity: number     // min(cols * rows, CARD_PAGE_MAX)
  gap: number          // columns between two cards
}

/** `null` when the region cannot carry one whole card — the screen falls back to the list. */
export function cardGrid(o: { width: number; height: number }): CardGrid | null

export interface CardPage { page: number; pages: number; from: number; to: number }
export function cardPage(total: number, capacity: number, page: number): CardPage

/** The group label of each session row, taken from the heading above it. */
export function cardBadges(rows: readonly SessionRow[]): string[]

export interface CardLine { key: string; text: string; kind: 'title' | 'state' | 'fact' | 'say' }
export function cardLines(s: ControlSession, labels: CardLabels): CardLine[]
export function fitCardLines(lines: readonly CardLine[], rows: number): CardLine[]

/** Which card a click landed on, resolved against the grid that drew it. */
export function cardAt(grid: CardGrid, x: number, y: number): number | null

/** The pager is a ROW and it is paid for out of the band. */
export function cardBand(listRows: number): { gridRows: number; pager: boolean }
```

**Width is exact:** `cols * cardWidth + gap * (cols - 1) <= width`, always. The remainder of an
uneven division is left as trailing air rather than distributed, because a card one column wider
than its share is a card whose frame is truncated by the pane it was measured against.

**Height is exact:** the grid asks for `rows * cardHeight <= height`. `cardHeight` degrades from the
full card (frame + 5 content lines) down to a floor (frame + 3) before `rows` is reduced — a card
with fewer facts is still a card, a grid with no rows is nothing.

**`fitCardLines` cuts from the bottom**, like `fitDetailLines`: the title and the state line are
what a card cannot lose, and they are the first two.

### Card content

| line | content | omitted when |
|---|---|---|
| frame title | the handle (`3f5f`) | the row has no handle of ours — then the harness |
| frame badge | the group label | never (falls back to the project) |
| title | the session's display name | never |
| state | state word (coloured) · harness, plus `attached` / external / blind markers | never |
| usage | tokens · cost · how long ago | nothing was recorded — the line is ABSENT, never `0` |
| where | worktree or project · model | both absent |
| say | `lastLines[0]` — what it is saying now | the host reported none (external, closed) |

An absent fact is an absent line. A harness that cannot report usage must not render every one of
its sessions costing nothing — the same N/A-versus-a-confident-0 rule `HARNESS_CAPABILITIES` states
for the dashboard and `sessionMetric` already follows for the list row.

### Keys

| key | in cards | why |
|---|---|---|
| `f` | list ⇄ cards | free (`v c e u a / x n t o l d j k g G`, space, digits, `q r m [ ]` are taken); also a row in the menu's `view` block, since that block is where every other arrangement decision lives |
| `←` `→` | previous / next card | the screen already claims the arrows; in a grid they are the horizontal axis |
| `↑` `↓` | up / down one grid ROW (`± cols`) | the vertical axis of the same grid |
| `pgup` `pgdn` | previous / next page | |
| `home` `end` | first / last card | |

The page is always the one holding the cursor: moving past the last card of a page advances it, and
`pgdn` moves the cursor to the first card of the next page. There is no second cursor to keep in
sync.

The footer names these keys, and only in cards mode — a hint for a key that does nothing is the one
bug that footer exists to prevent.

### Mouse

Clicking a card selects it AND focuses the list, the same pairing the list rows already have (a
pointer that selects without focusing leaves the frame saying one thing while the keys do another).
Clicking `‹` / `›` on the pager changes page. Both are resolved against `cardAt` / the pager's own
measured cells — the same arithmetic that drew them.

### Persistence

```ts
// packages/tui/src/control/types.ts
export interface SessionViewPrefs {
  …
  layout?: SessionLayout   // absent reads DEFAULT_SESSION_VIEW.layout
  cardAnchor?: string      // id of the first card of the page
}
export const DEFAULT_SESSION_VIEW: SessionViewPrefs = { …, layout: 'list' }
```

Mirrored field-for-field in `preferences.ts`'s `sessionView`.

**Every restored field falls back to `DEFAULT_SESSION_VIEW`, never to a literal.** `?? false` on a
field whose default is `true` is a bug that has already shipped here once: it turned the strict
filter off on every machine that had a `preferences.json`, and the persist effect then wrote that
off to disk, making it permanent.

## Testing

`sessions.test.ts`, in the shape the file already uses:

- **Width sweep** — for `w` in 20..200 and `h` in 6..44, `cardGrid` either returns `null` or a grid
  whose drawn width fits `w` and whose drawn height fits `h`. This is the `projectColumns` test
  ("never draws a row wider than the pane it was measured against") applied in two dimensions.
- **Capacity** — never above `CARD_PAGE_MAX`; equals `cols * rows` below it.
- **`cardPage`** — clamps a page past the end, reports `pages` correctly for a total that divides
  exactly and one that does not, and answers `{pages: 1, from: 0, to: 0}` for an empty fleet.
- **`cardBadges`** — one label per session row, in order; the closed section's own heading; the
  project as the fallback with grouping off.
- **`cardLines`** — no usage line for a session with neither tokens nor cost; no `say` line without
  `lastLines`; title and state always present.
- **`fitCardLines`** — cuts from the bottom and never drops the title or the state.
- **`cardAt`** — every drawn card's own cells resolve to its index; the gap between two cards and
  the air past the last column resolve to `null`. Cross-checked against `cardGrid` so the hit test
  and the layout can never be two answers.

## Verification

- `bun tsc --noEmit` clean, `bun test` green.
- `bun packages/tui/scripts/preview.tsx --screen sessions --keys f …` at widths 60/90/130/190 and
  heights 12/20/30/44, in both languages: every frame reports `✓ every row fits`.
- The preview fixture grows what the cards need (a session with `lastLines`, one with no usage at
  all) so the empty cases are drawn rather than assumed.

## Out of scope

- **`ViewOptions`** (the full-screen `v` panel) does not get the switch. It is already a smaller,
  older copy of the aside menu, and putting one decision on two screens is how the two disagree.
- **The list layout is unchanged** — same columns, same scrollbar, same keys.
