import React from 'react'

/**
 * The sentence under a number.
 *
 * ## Why this is a component and not fourteen inline divs
 *
 * The rule this codebase now holds is that a token figure may not appear without an account of what
 * produced it — these numbers reach the billions, and an unexplained total at that magnitude reads
 * as a fault rather than as information. Applying that rule meant writing the same small block of
 * styles on every panel that shows one, and fourteen copies of a style is fourteen chances for the
 * explanation to look like a different kind of thing on each screen. A reader learns "small dim text
 * under the number is what the number means" exactly once, or not at all.
 *
 * ## It is always visible
 *
 * Deliberately not a tooltip. A `title` attribute does not exist on a phone, and this text is most
 * needed by the person who is confused right now — putting it behind a hover hides it from half the
 * audience and from all of the audience in a hurry.
 *
 * `tone="warn"` is for a note that qualifies the number rather than describing it: an estimate, an
 * attribution, a figure that is not what you are billed. It is a weak amber and never the fault red,
 * because nothing here is broken — the number is simply not the thing a reader would assume.
 */
export function MetricNote({ children, tone = 'plain', style }: {
  children: React.ReactNode
  tone?: 'plain' | 'warn'
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        fontSize: 10.5,
        lineHeight: 1.5,
        color: tone === 'warn' ? 'var(--accent-amber, #b45309)' : 'var(--text-tertiary)',
        marginTop: 6,
        maxWidth: 620,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
