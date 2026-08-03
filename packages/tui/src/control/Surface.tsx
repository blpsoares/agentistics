/**
 * Surface.tsx — the pieces the LINEAR screens are drawn from.
 *
 * `Chrome.tsx` holds the rows that are always on screen and the cockpit's own primitives; this
 * holds what Setup, Logs, Help, the cheat sheet and Contribute have in common. Both follow the same
 * rule as everything else in this tree: no arithmetic here (it is in `surface.ts`), no strings here
 * (they arrive localized), only placement and color.
 */

import React from 'react'
import { Text } from 'ink'
import { COLORS } from '../theme'
import { truncate } from '../components/Primitives'
import { clampLines, sectionHead, wrapText } from './surface.ts'

/**
 * A section header: a dim title carried to the right edge by a rule.
 *
 * The linear screens get exactly one pane each — the shell frames them — so their internal
 * structure has to be drawn rather than framed. The rule is the same gesture a pane's top border
 * makes, which is what stops these screens from looking like a different application than the
 * cockpit; the title stays UPPERCASE and dim (small caps, which no terminal has) so a header is
 * never mistaken for a row of content on a palette that has been flattened to one color.
 */
export function SectionHeader({ title, width }: { title: string; width: number }) {
  const head = sectionHead(title, width)
  return (
    <Text>
      <Text dimColor bold>{head.title}</Text>
      <Text color={COLORS.border}>{head.rule}</Text>
    </Text>
  )
}

/**
 * A plain rule across the row, in the border's color.
 *
 * Used where a section has a HEADER of its own already — the log viewer's source selector, which
 * carries its follow state on the same row — and only needs the line under it that separates chrome
 * from content. It is the pane's border, continued inwards.
 */
export function Divider({ width }: { width: number }) {
  if (width <= 0) return null
  return <Text color={COLORS.border}>{'─'.repeat(width)}</Text>
}

/**
 * The one-line explanation a screen opens with, wrapped rather than cut.
 *
 * It is capped at `maxRows` because the caller has already budgeted the rows underneath it: prose
 * that decided its own height would push the body off the bottom of a pane, and Ink composites that
 * overflow rather than clipping it. Two rows is the default because every intro in the app is one
 * sentence, and a sentence that needs three is a sentence that belongs on the Help screen.
 */
export function Intro({ text, width, maxRows = 2 }: {
  text: string
  width: number
  maxRows?: number
}) {
  return (
    <>
      {introLines(text, width, maxRows).map((line, i) => (
        <Text key={i} dimColor>{line}</Text>
      ))}
      <Text> </Text>
    </>
  )
}

/** How many rows an `Intro` will take, including its trailing blank — the caller's row budget. */
export function introRows(text: string | undefined, width: number, maxRows = 2): number {
  return text ? introLines(text, width, maxRows).length + 1 : 0
}

function introLines(text: string, width: number, maxRows: number): string[] {
  return clampLines(wrapText(text, width), maxRows, width)
}

/**
 * A question, in the voice every question in this app uses: bold, wrapped, capped.
 *
 * Bold rather than accent — the accent is the cursor's color, and a question that competed with it
 * would leave two things on screen claiming to be what the keyboard is talking to.
 */
export function Question({ text, width, maxRows = 3 }: {
  text: string
  width: number
  maxRows?: number
}) {
  return (
    <>
      {clampLines(wrapText(text, width), maxRows, width).map((line, i) => (
        <Text key={i} bold>{line}</Text>
      ))}
    </>
  )
}

/** How many rows a `Question` will take at this width. */
export function questionRows(text: string, width: number, maxRows = 3): number {
  return clampLines(wrapText(text, width), maxRows, width).length
}

/**
 * A dim aside under a question — why it is being asked, or what the answer costs.
 *
 * One row, truncated rather than wrapped: it is the least important thing on the screen, and prose
 * that grows would take its rows from the options it is explaining.
 */
export function Aside({ text, width }: { text: string; width: number }) {
  return <Text dimColor>{truncate(text, width)}</Text>
}
