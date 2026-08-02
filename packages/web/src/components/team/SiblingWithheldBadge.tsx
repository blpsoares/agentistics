import { Info } from 'lucide-react'
import { COPY, interpolate } from './copy'
import type { WithholdingMachine } from './siblingWarnings'

/**
 * SiblingWithheldBadge.tsx — the per-row half of the reverse sharing warning: "another machine of
 * your account does not share this", shown on the row ITSELF so it is readable before the switch
 * is flipped rather than after.
 *
 * It renders NOTHING when `machines` is absent or empty, and that is the whole contract: this
 * machine only knows what its siblings have announced to it, so "no icon" means "nothing was
 * announced about this row", never "no machine restricts it". That is exactly why
 * `siblingWithholdBestEffort` is inside the disclosure and not somewhere else on the screen — the
 * sentence and its caveat are one statement, and the caveat is the half that stops the feature
 * from misleading.
 *
 * WHY AN ICON AND NOT A PILL. It used to be an orange pill of text sitting directly under the row,
 * a few pixels from the repository's host tag. Two objects of the same size and shape, one saying
 * what the row IS and one cautioning about what the row WILL DO — read as the same kind of thing,
 * so the caution stopped registering as one. The icon is now the standing signal and the sentence
 * is disclosed on demand. It keeps the advisory colour (this IS advisory) and is always rendered,
 * because a warning that has to be discovered before it can be seen is not a warning.
 *
 * Disclosure is CSS-only (`.ag-hint`, index.css): `:hover` for a pointer, `:focus-within` for the
 * keyboard AND for touch, since tapping the button focuses it. No hooks, so this stays a plain
 * function the tests can call directly, and no state that could be left open on a row that
 * re-sorted underneath it. The button carries the full sentence as its `aria-label`, so a screen
 * reader never depends on the visual disclosure at all.
 *
 * `dimension` picks the wording, and it is not cosmetic. Repositories correlate across machines on
 * a normalized remote — an exact key — so "not shared on X" is a statement of fact. Projects
 * correlate on FOLDER NAME, because the same project sits at a different path on every machine, so
 * the row can only claim "a project with this name". Using the repo wording on a project row would
 * assert an identity nothing here established.
 *
 * Purely presentational — every decision is made by `siblingWarnings.ts`, which is tested.
 */
export function WithheldBadge({ machines, lang, dimension }: {
  machines: readonly WithholdingMachine[] | undefined
  lang: 'pt' | 'en'
  dimension: 'repo' | 'project'
}) {
  if (!machines || machines.length === 0) return null
  const row = dimension === 'project' ? COPY.siblingWithholdRowProject : COPY.siblingWithholdRow
  // A machine the central never named renders as words, never as a blank or an id.
  const sentence = interpolate(row[lang], {
    machines: machines.map(m => m.name || COPY.peerUnnamed[lang]).join(', '),
  })
  const caveat = COPY.siblingWithholdBestEffort[lang]
  return (
    <span className="ag-hint" style={{ flexShrink: 0, lineHeight: 0 }}>
      <button
        type="button"
        className="ag-hint-btn"
        // The full statement, caveat included, for anyone who never sees the disclosure.
        aria-label={`${sentence} ${caveat}`}
        title={`${sentence} ${caveat}`}
        style={{
          border: 'none', background: 'transparent', padding: 2, cursor: 'help',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--anthropic-orange)', fontFamily: 'inherit',
        }}
      >
        <Info size={13} />
      </button>
      {/* The bubble is sized ENTIRELY by `.ag-hint-body` (index.css) and carries no inline style.
          That is the fix, not a tidy-up: `max-width: 100%` here resolved against `.ag-hint` — an
          inline-flex wrapper the width of a 13px icon — so the box capped at ~17px, and the
          inherited `overflow-wrap: anywhere` then broke inside words to fit it. The sentence came
          out as a vertical column of single letters. A width can only be stated against the
          VIEWPORT, and the stylesheet is the only place that can see one. */}
      <span className="ag-hint-body" role="tooltip">
        <span style={{ display: 'block', color: 'var(--anthropic-orange)', fontWeight: 600 }}>{sentence}</span>
        {/* Load-bearing: an absent warning is never proof that no machine restricts this row. */}
        <span style={{ display: 'block', marginTop: 4, color: 'var(--text-tertiary)' }}>{caveat}</span>
      </span>
    </span>
  )
}
