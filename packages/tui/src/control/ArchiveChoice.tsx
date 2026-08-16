/**
 * ArchiveChoice — the history-preservation consent, asked identically wherever it comes up.
 *
 * It is a gate, not a preference: `cli-setup.ts`'s `ensureArchiveModeChosen()` runs before a
 * foreground start, before the wizard finishes, and before a background start — so the question
 * has more than one caller and must not be re-typed at each of them. One component means the three
 * options, their order and the preselected recommendation cannot drift between the Setup screen and
 * the cockpit's background start.
 *
 * The question is wrapped and the reason under it is dim: this is the one question in the app whose
 * answer is irreversible in the sense that matters (a machine left on `off` preserves nothing while
 * the user believes they were asked something else), so the sentence explaining WHY is worth its row
 * and must not be cut in half by a narrow column.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { Menu } from './Menu'
import { Aside, Question, questionRows } from './Surface'
import type { ControlStrings } from './i18n'
import type { ArchiveMode } from './types'

const ORDER: readonly ArchiveMode[] = ['consolidate', 'full', 'off'] as const

/** The reason, the blank row under it, and the three options. */
const ASIDE_ROWS = 2

/** The skip is a menu ROW, not an `esc` the user has to guess at. This question is the one the
 *  opening gate asks unprompted, so declining to answer it has to be as visible as answering it —
 *  and the row states what the skip costs, since a silent skip is how a machine ends up preserving
 *  nothing. `esc` still cancels; the row is what makes the option discoverable. */
const SKIP = '__later__'

export function ArchiveChoice({ strings: s, suggested, onPick, onSkip, onCancel, width, height, isActive, origin }: {
  strings: ControlStrings
  /** The recommended answer, preselected. */
  suggested: ArchiveMode
  onPick: (mode: ArchiveMode) => void
  /** Offered only where declining is legitimate — the opening gate. Absent elsewhere, and then the
   *  menu has no such row: a start that needs the consent must not be able to proceed without it. */
  onSkip?: () => void
  onCancel: () => void
  width: number
  height: number
  isActive: boolean
  /** Where this question's first row sits in the frame the shell is emitting. See `Menu.origin`. */
  origin?: { x: number; y: number }
}) {
  // Measured from what the question actually wraps to, rather than assuming the two rows it used to
  // take: at 40 columns it is three, and a menu budgeted for two would have drawn its last option
  // on top of the pane's bottom border.
  const asked = questionRows(s.archiveQuestion, width)

  return (
    <Box flexDirection="column">
      <Question text={s.archiveQuestion} width={width} />
      <Aside text={s.archiveWhy} width={width} />
      <Text> </Text>
      <Menu
        items={[
          { label: s.archiveConsolidate, value: 'consolidate', hint: s.archiveConsolidateHint },
          { label: s.archiveFull, value: 'full', hint: s.archiveFullHint },
          { label: s.archiveOff, value: 'off', hint: s.archiveOffHint },
          ...(onSkip ? [{ label: s.archiveLater, value: SKIP, hint: s.archiveLaterHint }] : []),
        ]}
        initialIndex={Math.max(0, ORDER.indexOf(suggested))}
        onSelect={value => (value === SKIP ? onSkip?.() : onPick(value as ArchiveMode))}
        // Ctrl-C out of `cli-setup.ts` is non-destructive; esc is its equivalent here — the
        // question comes back the next time the host says it is still unanswered.
        onCancel={onCancel}
        width={width}
        isActive={isActive}
        height={Math.max(1, height - asked - ASIDE_ROWS)}
        // The wrapped question and the two rows under it are what stand between this question's
        // origin and its first option — measured, because at 40 columns the question is three rows.
        origin={origin && { x: origin.x, y: origin.y + asked + ASIDE_ROWS }}
      />
    </Box>
  )
}
