/**
 * Pane — the one containment style in the control center.
 *
 * Every framed region on every screen goes through this: the cockpit's four panes, the log viewer,
 * the setup form, the read-only screens. One component is what makes six screens read as one
 * application — before it, each screen invented its own idea of what a section looked like, and the
 * app looked like six authors rather than one product.
 *
 * The frame is half Ink's and half hand-drawn, for one reason: Ink's `borderStyle` cannot put a
 * title IN the border, and a title above the border is a caption, not a label. So the top row is
 * drawn here — where the title, the rule and the badge can each take their own color — and the
 * remaining three sides are Ink's own `borderTop={false}` box, which is exact and needs no
 * per-row `│` of our own.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { COLORS } from '../theme'
import { PANE_FRAME_Y, PANE_MIN_ROWS, paneInnerWidth, paneTop } from './chrome.ts'

export interface PaneProps {
  /** Drawn in the top border. Empty is allowed — a very narrow pane loses its title first. */
  title?: string
  /** Right-hand side of the top border: a runtime, a follow state, a count. */
  badge?: string
  /**
   * Accent border and bold title when true, so the pane the keyboard is talking to is obvious.
   * `undefined` means the surface has no focus model at all (the read-only screens), and the pane
   * is drawn unfocused rather than competing for attention it cannot receive.
   */
  focused?: boolean
  /**
   * Paint the frame and title in the DANGER colour, overriding focus.
   *
   * A pane in a destructive mode (bulk-stop) is not merely focused — the whole box is a warning, so
   * the border and its title go red and outrank the accent a focused pane would otherwise wear.
   */
  alert?: boolean
  width: number
  /** Total rows INCLUDING the frame. Content gets `height - 2`. */
  height: number
  children?: React.ReactNode
}

export function Pane({ title = '', badge = '', focused, alert, width, height, children }: PaneProps) {
  if (height <= 0 || width <= 0) return null

  const border = alert ? COLORS.danger : focused ? COLORS.accent : COLORS.border
  const titleColor = alert ? COLORS.danger : focused ? COLORS.accent : COLORS.label

  // Too short to frame. Rather than draw a box with no inside — or, worse, let Ink composite the
  // border rows on top of the content — the pane gives up its frame and keeps its rows. This is the
  // bottom of the degradation ladder in `cockpitLayout`, and it is still readable.
  if (height < PANE_MIN_ROWS) {
    return (
      <Box flexDirection="column" width={width} height={height} flexShrink={0} overflow="hidden">
        {children}
      </Box>
    )
  }

  const top = paneTop(title, badge, width)

  return (
    <Box flexDirection="column" width={width} height={height} flexShrink={0}>
      <Text color={border}>
        {top.head}
        {/* Never `dimColor`: at half intensity over a dark background the title is unreadable, and
            it is the only thing on the frame that says what the box holds. */}
        <Text color={titleColor} bold>
          {top.title}
        </Text>
        {top.gap}
        <Text dimColor>{top.badge}</Text>
        {top.tail}
      </Text>
      {/* `flexShrink={0}` plus `overflow="hidden"` is the guarantee that a body one row too tall is
          CUT rather than compressed: Ink's default shrink hands several rows the same y and paints
          them into the same cells, which reads as a corrupted frame rather than as a cramped one. */}
      <Box
        borderStyle="round"
        borderTop={false}
        borderColor={border}
        width={width}
        height={height - 1}
        paddingX={1}
        flexDirection="column"
        flexShrink={0}
        overflow="hidden"
      >
        {children}
      </Box>
    </Box>
  )
}

/** Content columns a pane of `width` offers — the number every child must budget against. */
export const paneBody = (width: number): number => paneInnerWidth(width)

/** Content rows a pane of `height` offers. */
export const paneRows = (height: number): number =>
  height < PANE_MIN_ROWS ? Math.max(0, height) : Math.max(0, height - PANE_FRAME_Y)
