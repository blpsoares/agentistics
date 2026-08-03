# C4 — Dedicated mobile UI pass (design)

**Date:** 2026-07-24
**Roadmap:** `docs/superpowers/ROADMAP.md` → Group C → C4 (ULTRA IMPORTANT)
**Branch:** `dev`

## Problem

Every surface built during B4-EXT and the governance work was designed on a desktop
viewport. None of the governance settings pages import `useIsMobile`, and the left
`SideNav` — which is the only host for the account menu — is not rendered at all below
`MOBILE_BREAKPOINT` (768px). The result is one functional hole (a phone user cannot log
out or change their password) plus a set of layout regressions.

This pass audits and fixes those surfaces. It does not redesign anything that already
works on mobile (`FiltersBar` base layout, `MobileBottomNav`, full-screen content modals,
the `overflow-x: clip` iOS fix, the `.ag-grid` responsive utility).

## Audit — what is actually broken

| # | Surface | File | Defect |
|---|---------|------|--------|
| 1 | Account menu (avatar → change password / log out), theme toggle, language toggle, member connection status | `App.tsx:1915` | `SideNav` is desktop-only; these actions exist nowhere on mobile. **Functional loss, not cosmetic.** |
| 2 | Users / Teams / Machines listings | `UsersSettings.tsx:502`, `TeamsSettings.tsx:326`, `MachinesSettings.tsx:705` | Real `<table>` elements wrapped in `overflowX: auto`. Zero `useIsMobile` in all three files. On a 390px screen they become a horizontal scroll strip. Row action buttons (14px icons in a 40px cell) are far below a 44px touch target. |
| 3 | Read-first drawers | `settings/Drawer.tsx`, `primitives.tsx` `Section` | Drawer already goes full-width on mobile (correct). But per-section Save/Cancel sit inline in a long scrolling column, so on a tall drawer the user must scroll to the bottom to commit an edit. Buttons are `7px 12px` — small for touch. |
| 4 | Searchable `Select` | `primitives.tsx:392` | Popover is `position: absolute` with `maxHeight: 280`, no upward flip — inside the scrollable `Drawer` it can render past the viewport bottom. Search input is `fontSize: 13`, which triggers iOS Safari auto-zoom (<16px). Option rows are ~33px tall. Placeholder is hardcoded Portuguese `"Buscar…"`, violating the English-only rule. |
| 5 | `ConfirmModal` | `primitives.tsx:41` | Centered `maxWidth: 420` dialog with small right-aligned buttons; destructive confirm and cancel sit adjacent at ~30px height. |
| 6 | Filtered totals + fleet stats strip | `App.tsx:2042`, `App.tsx:2126` | Both gated on `!isMobile`. Sessions/cost/tokens and members/machines/teams/projects/repos are simply absent on mobile. |
| 7 | `FiltersBar` new C3 dimensions (Teams / Machines / Members) | `FiltersBar.tsx` | Base mobile handling exists and works. The dimension pickers added by C3 — and the manager/owner gating (`canFilterMembers`) — have never been exercised at 390px inside the animated `overflow: hidden` wrapper. Verification item, not a known break. |
| 8 | `TeamRepos`, `DeployCentral` | `TeamRepos.tsx:153`, `DeployCentral.tsx:107` | `<pre whiteSpace: 'pre'; overflowX: auto>` blocks holding a GitHub Actions workflow and docker commands. They do not break the page, but on a phone they are unreadable scroll strips where the real action is "copy". |

`components/TeamMembers.tsx` already has mobile branches (`:481`, `:711`) and is out of
scope except for regression checking.

## Design

### Principle

Reuse the conventions already in `CLAUDE.md`. No new chrome, no new breakpoint, no new
state container. Every fix is either a branch on `useIsMobile()` or a change to a shared
primitive so all three governance pages inherit it.

### 1. Account, theme and language move into the "More" sheet

`MobileBottomNav` gains `principal`, `theme`, `onToggleTheme`, `onToggleLang` and
`isCentral` props (it already takes `isCentral`). The sheet grows an **account block**
above the tile grid:

```
┌── More ───────────────────┐
│ ⬤ Bryan Luccas    OWNER  │  ← tap → expands to Change password / Log out
│   ● connected · 12ms      │  ← MemberConnectionStatus, member machines only
├───────────────────────────┤
│ [Sessions][Repos ][Custom]│
│ [Export  ][Live  ][Refr. ]│
│ [Settings][Theme ][Lang  ]│
└───────────────────────────┘
```

- The account row is a button; tapping it swaps the tile grid for two full-width rows
  (Change password, Log out) with a back affordance. This avoids a nested popover, which
  is the thing that behaves worst on a phone.
- Change password reuses `ChangePasswordSelf` unchanged (it is already a modal).
- Log out reuses the existing `POST /api/iam/logout` + reload.
- Theme and Language become two more tiles in the existing 3-column grid, using the same
  `Tile` type — no new tile styling.
- `MemberConnectionStatus` renders `compact` under the account name, and only when
  `!isCentral`, mirroring the sidebar.

The account block renders only when `principal` is present, so a solo machine with no IAM
sees exactly today's sheet plus Theme and Language.

### 2. Governance tables collapse into cards

Add one primitive to `pages/settings/primitives.tsx`:

```tsx
export function RecordCard({ title, subtitle, badge, fields, actions, onClick }: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  badge?: React.ReactNode          // role / presence pill, top-right
  fields: { label: string; value: React.ReactNode }[]
  actions?: React.ReactNode        // footer row, buttons stretch to fill
  onClick?: () => void             // whole-card tap opens the detail drawer
})
```

Layout: title + badge on the first line, subtitle (email / remote) beneath it, then the
`fields` as label/value rows, then a bordered footer holding `actions`. Footer buttons get
`minHeight: 44` and `flex: 1` so a two-action card yields two half-width 44px targets.

Each of the three pages then branches once:

```tsx
{isMobile
  ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(r => <RecordCard key={r.id} … />)}
    </div>
  : <div style={{ overflowX: 'auto' }}><table>…</table></div>}
```

The desktop table is left byte-for-byte intact. The card branch reuses the same badge and
chip sub-components already defined in each page (`RoleBadge`, team chips, presence dot),
so there is no visual drift between the two renderings.

Selection state on the Machines page (bulk delete) maps to a leading checkbox inside the
card's first line; bulk-action bars become full-width sticky rows above the card list.

### 3. Drawer gains an optional sticky footer; `Section` buttons stretch

- `Drawer` accepts an optional `footer?: React.ReactNode`, rendered in a
  `position: sticky; bottom: 0` bar with a top border and the card background. Pages that
  have a general save button pass it there; pages that do not are unaffected.
- `Section`'s Save/Cancel row becomes `flexDirection: column-reverse` with full-width
  `minHeight: 44` buttons on mobile (Save on top, thumb-reachable), and keeps the current
  right-aligned inline row on desktop. This is a `useIsMobile()` branch inside the
  primitive, so every drawer inherits it.

### 4. `Select` fixes

All inside `primitives.tsx`:

- **Flip up when it would overflow.** Measure the trigger with `getBoundingClientRect()`
  on open; if `window.innerHeight - rect.bottom < 300`, render the popover with
  `bottom: calc(100% + 4px)` instead of `top`.
- **iOS zoom guard.** The search input uses `fontSize: 16` when `isMobile` (13 on
  desktop). This is the documented threshold below which Safari zooms the viewport.
- **Touch targets.** Option rows get `minHeight: 44` and `padding: 11px 12px` on mobile.
- **Language.** Replace the hardcoded `"Buscar…"` with a `searchPlaceholder` prop
  defaulting to `'Search…'`, per the project's English-only rule.

### 5. `ConfirmModal` on mobile

Keep it centered (a two-button confirm is not a content modal, so the full-screen
convention does not apply), but on mobile: `width: 100%`, buttons become a stacked
full-width pair with `minHeight: 44`, cancel below confirm. Escape and backdrop-cancel
behaviour is unchanged.

### 6. Mobile header: filtered totals and fleet stats

Below the collapsible `FiltersBar` on mobile, render a single compact strip carrying the
same numbers the desktop header shows:

```
127 sessions · $4.21 · 8.2M tok                    ⌄
```

Tapping the chevron expands the fleet stats (updated / since / members / machines / teams
/ projects / repos) as a wrapped chip row — the mobile equivalent of the desktop
"orelinha". Collapsed is the default and the state is local to the header, matching how
`filtersCollapsed` already works. The numbers come from the same `derived` and
`statsCache` values the desktop branch reads; no new computation.

### 7. `FiltersBar` verification

No planned change. The Teams / Machines / Members pickers and the `canFilterMembers`
gating are exercised at 390px; any clipping is fixed with the existing `filtersClip` /
`onTransitionEnd` mechanism rather than a new approach. Any picker popover that can
overflow gets the same flip-up treatment as `Select`.

### 8. `TeamRepos` / `DeployCentral`

The code blocks stay as scrollable `<pre>` — wrapping shell commands and YAML makes them
wrong to copy. Instead, on mobile:

- Each block's copy button becomes a full-width `minHeight: 44` button directly beneath
  the block, since copying (not reading) is the actual task on a phone.
- `fontSize` drops to 11 and the block gets `maxHeight: 240` with vertical scroll so a
  40-line workflow snippet does not push the rest of the panel off screen.

## Out of scope

- Any change to desktop rendering. Every fix is behind `useIsMobile()` or is additive.
- `TeamMembers.tsx`, which already has mobile branches.
- Tablet-specific layouts. The project has one breakpoint and this pass keeps it.
- The C3 filter semantics themselves — only their mobile presentation.

## Phasing

Ordered by user impact, each phase independently shippable and verifiable:

1. **Account access** — More sheet account block + Theme/Language tiles. Closes the
   functional hole.
2. **Governance tables** — `RecordCard` primitive + the three page branches.
3. **Drawer and primitives** — Drawer footer, `Section` buttons, `Select` flip/zoom/touch/
   placeholder, `ConfirmModal`.
4. **Header parity** — mobile totals strip + collapsible fleet stats.
5. **Verification sweep** — `FiltersBar` C3 pickers, `TeamRepos`, `DeployCentral`, and a
   regression pass over `TeamMembers` and the existing mobile surfaces.

## Verification

- `bun tsc --noEmit` and `bun test` after every phase; `bun run build` before declaring a
  phase done.
- Visual verification against the running central at `localhost:48080` with the viewport
  resized to 390px, signed in as both an owner (`owner@example.com`) and a plain
  user (`member@example.com`) so the scoped/gated branches are both exercised.
- Before trusting any visual check, confirm the listener on the port is the freshly built
  code — the Linux (WSL) `bun` must own it, never the Windows `bun.exe`.
- Desktop regression: the same pages at 1440px must be pixel-identical to today, since
  every change is additive or branched.
