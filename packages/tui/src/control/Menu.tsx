/**
 * Menu — the single selection primitive of the control center.
 *
 * It replaces `server/cli-ui.ts`'s `select` on the TTY path and keeps its behaviour to the letter:
 * a single `❯` marker, dim hints after the label, and disabled entries that are visible but
 * skipped by navigation (they explain WHY an action is unavailable, which a hidden row cannot).
 *
 * It is also the body of every question the cockpit asks — "how should it run?", the archive
 * consent, every yes/no — so it is drawn to the cockpit's vocabulary: the same `❯` cursor as the
 * services list, the same accent on the selected row, the same dim hint column. A question that
 * looked like a different application would undo the point of framing it in the cockpit's own pane.
 *
 * Every key rule comes from `nav.ts` and every width from `surface.ts`, so both stay testable
 * without mounting Ink. The component holds only the cursor and the scroll window.
 */

import React, { useEffect, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { COLORS } from '../theme'
import { truncate } from '../components/Primitives'
import { resolveDigit, resolveListKey, scrollBy, windowOffset, type NavKey } from './nav'
import { menuCells } from './surface.ts'
import { listRowAt } from './hit'
import { isActivation, wheelDelta } from './mouse'
import { usePointer } from './pointer'

export interface MenuItem {
  label: string
  value: string
  /** Dim text after the label, in a column aligned across the menu. */
  hint?: string
  /** Rendered dim and skipped by navigation, so an unavailable action still explains itself. */
  disabled?: boolean
  /** Destructive — marked with `!` so "Stop everything" cannot be picked by reflex. */
  danger?: boolean
}

export interface MenuProps {
  items: MenuItem[]
  onSelect: (value: string, item: MenuItem) => void
  /** esc. Omit on a root menu that has nothing to go back to. */
  onCancel?: () => void
  /** Terminal columns available to the menu. Rows are truncated to fit, never wrapped. */
  width: number
  /** Gates `useInput`, so a menu behind an overlay or a modal does not eat keys. */
  isActive: boolean
  /** Max rows for the list. When the menu is longer it scrolls and shows count markers. */
  height?: number
  /** Where the cursor starts; ignored when it points at a disabled item. */
  initialIndex?: number
  /**
   * Digit accelerators, drawn as `N.` and honoured as keys. Default true.
   *
   * It used to have to be FALSE on any menu that was not capturing the keyboard: the screens were
   * reachable by digit from anywhere and the shell answered first, so a numbered row printed an
   * accelerator that changed screen instead of choosing the row beside it. The screens move on
   * `←`/`→` alone now, and the digits belong to whatever list is drawing them — which is what makes
   * a number beside a row safe to press again.
   *
   * A digit MOVES the cursor; `enter` is what runs the row. See the input handler for why.
   */
  numbered?: boolean
  /**
   * How the "n rows hidden" markers read. Digits and arrows only by default: the marker is chrome
   * the host never sees, and a bare number needs no translation.
   */
  moreLabel?: (n: number) => string
  /**
   * Where this menu's FIRST row sits in the coordinates the shell is emitting.
   *
   * The menu knows how tall its own rows are and nothing else — a form draws prose above it, a
   * confirmation draws a question, the cockpit frames it in a pane — so whoever placed it is the
   * only side that can say where it starts. Omitted, the menu is at the origin of its frame, which
   * is what a surface with nothing above it wants.
   */
  origin?: { x: number; y: number }
}

/** Marker rows are reserved on both sides while scrolling so the menu never exceeds `height`. */
const MARKER_ROWS = 2

/**
 * A menu that was told nothing sits at the top-left of whatever frame it is in.
 *
 * Frozen at module scope rather than written inline as a default: `usePointer` resubscribes when its
 * inputs change, and a fresh object on every render would do that on every keystroke.
 */
const ORIGIN = { x: 0, y: 0 }

/**
 * `! ` in front of a destructive verb.
 *
 * The palette is not allowed to be the only thing that says "this one stops a server": a terminal
 * that has been flattened to one color, or a user who cannot separate red from amber, would see a
 * row that reads exactly like the safe one above it.
 */
const DANGER_MARK = '! '

const wrapIndex = (n: number, len: number) => ((n % len) + len) % len

/** First selectable item at or after `from`, walking in `dir`. Returns `from` if all are disabled. */
function nextEnabled(items: MenuItem[], from: number, dir: 1 | -1): number {
  for (let step = 0; step < items.length; step++) {
    const i = wrapIndex(from + dir * step, items.length)
    if (!items[i]?.disabled) return i
  }
  return from
}

export function Menu({
  items,
  onSelect,
  onCancel,
  width,
  isActive,
  height,
  initialIndex,
  numbered: wantNumbers = true,
  moreLabel,
  origin = ORIGIN,
}: MenuProps) {
  // Past nine the numbers stop matching what is on screen, so they are not offered either way.
  const numbered = wantNumbers && items.length <= 9
  const [index, setIndex] = useState(() =>
    items.length === 0 ? 0 : nextEnabled(items, initialIndex ?? 0, 1),
  )

  // The item list is rebuilt on every host refresh, so the cursor can end up past the end or on a
  // row that just became disabled. Re-snapping here keeps the marker on something selectable
  // instead of leaving an invisible cursor.
  useEffect(() => {
    setIndex(i => {
      if (items.length === 0) return 0
      const clamped = Math.min(i, items.length - 1)
      return items[clamped]?.disabled ? nextEnabled(items, clamped, 1) : clamped
    })
  }, [items])

  useInput((input, key) => {
    if (items.length === 0) return

    const nav: NavKey = {
      input,
      upArrow: key.upArrow,
      downArrow: key.downArrow,
      return: key.return,
      escape: key.escape,
    }

    if (key.escape) { onCancel?.(); return }

    if (key.return) {
      const item = items[index]
      if (item && !item.disabled) onSelect(item.value, item)
      return
    }

    // A digit JUMPS the cursor; it does not answer. Every menu in this app runs something the
    // moment it is answered — `1` on the Setup screen is `setMode('solo')`, which overwrites the
    // team block whole, token included, and `1` on any confirmation is a yes. One keypress, no
    // cursor to check it against and nothing to undo it with: pressing a digit to see what it
    // selects cost a real machine its member token during review. `enter` is the verb everywhere
    // else in this app, and it is the verb here too — the accelerator keeps the reach it advertises
    // and gives back the half-second in which a mistake is still a mistake.
    if (numbered) {
      const digit = resolveDigit(nav, items.length)
      if (digit != null) {
        if (!items[digit]?.disabled) setIndex(digit)
        return
      }
    }

    const moved = resolveListKey(nav, index, items.length)
    if (moved === index) return
    // `g`/`G` land on an end that may itself be disabled, so the search continues inward.
    const dir: 1 | -1 = key.upArrow || input === 'k' || input === 'G' ? -1 : 1
    setIndex(nextEnabled(items, moved, dir))
  }, { isActive })

  const hasHints = items.some(i => i.hint)
  // Measured over the labels as they will be DRAWN — a danger mark is two columns of label like any
  // other, and a column budgeted without it slides the hints of a menu that has one.
  const cells = menuCells(
    items.filter(i => !i.disabled).map(i => (i.danger ? DANGER_MARK : '') + i.label),
    { numbered, hints: hasHints, width },
  )

  const scrolling = height != null && items.length > height
  // Below three rows the markers cost more than they explain: reserving two of a two-row budget
  // leaves the list rendering three rows into a space for two, and Ink composites the overflow
  // into the row below instead of dropping it.
  const markers = scrolling && height! >= MARKER_ROWS + 1 ? MARKER_ROWS : 0
  const listHeight = scrolling ? Math.max(1, height! - markers) : items.length
  const offset = scrolling ? windowOffset(index, items.length, listHeight) : 0
  const visible = items.slice(offset, offset + listHeight)
  const hiddenAbove = markers > 0 ? offset : 0
  const hiddenBelow = markers > 0 ? items.length - (offset + listHeight) : 0
  const more = moreLabel ?? ((n: number) => String(n))

  /**
   * A click on a row ANSWERS it, where a digit only moves the cursor.
   *
   * The two look like the same shortcut and are not. A digit is exploratory — that is exactly how
   * pressing one to see what it selected cost a real machine its member token — while a click has
   * been aimed at a row whose label and hint the user was reading as they aimed. Nothing is
   * activated that the pointer was not on top of.
   *
   * Disabled rows stay inert, as they are to the keyboard: they are on screen to explain why an
   * action is unavailable, and a click that skipped to the nearest enabled row would run something
   * the user did not point at.
   */
  usePointer(p => {
    const y = p.y - origin.y
    const x = p.x - origin.x
    if (x < 0 || x >= width) return

    const wheel = wheelDelta(p.button)
    if (wheel !== 0) {
      if (!scrolling) return
      // Clamped rather than wrapped: a wheel that jumped from the last option to the first is a
      // gesture that teleports. `nextEnabled` then walks off any disabled row it landed on.
      const moved = scrollBy(index, wheel, items.length)
      if (moved !== index) setIndex(nextEnabled(items, moved, wheel > 0 ? 1 : -1))
      return
    }

    if (!isActivation(p)) return
    // The markers are rows too — `↑ 3` sits above the first item when the list has scrolled — so
    // the row under the pointer is counted from the same window the renderer sliced.
    const at = listRowAt(y, offset, visible.length, hiddenAbove > 0 ? 1 : 0)
    if (at === null) return
    const item = items[at]
    if (!item || item.disabled) return
    setIndex(at)
    onSelect(item.value, item)
  }, { isActive })

  if (items.length === 0) return null

  return (
    <Box flexDirection="column">
      {hiddenAbove > 0 ? <Text dimColor>{`  ↑ ${more(hiddenAbove)}`}</Text> : null}

      {visible.map((item, i) => {
        const at = offset + i
        const active = at === index
        const color = item.disabled
          ? undefined
          : item.danger
            ? COLORS.danger
            : active ? COLORS.accent : undefined
        const label = (item.danger ? DANGER_MARK : '') + item.label

        return (
          <Box key={item.value} flexDirection="row">
            <Text color={active ? COLORS.accent : undefined}>{active ? '❯ ' : '  '}</Text>
            {numbered ? <Text dimColor>{`${at + 1}. `}</Text> : null}
            <Box width={cells.hint > 0 ? cells.label : undefined}>
              <Text color={color} bold={active && !item.disabled} dimColor={item.disabled}>
                {truncate(label, cells.label)}
              </Text>
            </Box>
            {item.hint && cells.hint > 0
              ? <Text dimColor>{`  ${truncate(item.hint, cells.hint)}`}</Text>
              : null}
          </Box>
        )
      })}

      {hiddenBelow > 0 ? <Text dimColor>{`  ↓ ${more(hiddenBelow)}`}</Text> : null}
    </Box>
  )
}
