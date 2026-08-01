import { COPY, interpolate } from './copy'
import type { WithholdingMachine } from './siblingWarnings'

/**
 * SiblingWithheldBadge.tsx — the per-row half of the reverse sharing warning: "another machine of
 * your account does not share this", shown on the row ITSELF so it is readable before the switch
 * is flipped rather than after.
 *
 * It renders NOTHING when `machines` is absent or empty, and that is the whole contract: this
 * machine only knows what its siblings have announced to it, so "no badge" means "nothing was
 * announced about this row", never "no machine restricts it". The block-level warning in
 * `SharingRulesPicker` carries the sentence that says so; a badge has no room for it and must not
 * try to imply it.
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
  return (
    <span
      // Not `flexShrink: 0` (unlike the host pill beside it): the machine names are variable and
      // can be long, and the row is `flexWrap: 'wrap'`, so this must be allowed to take its own
      // line on a 390px card instead of pushing the row past the viewport.
      style={{
        fontSize: 10, padding: '2px 6px', borderRadius: 999, maxWidth: '100%',
        overflowWrap: 'anywhere',
        background: 'color-mix(in srgb, var(--anthropic-orange) 12%, transparent)',
        color: 'var(--anthropic-orange)',
        border: '1px solid color-mix(in srgb, var(--anthropic-orange) 35%, transparent)',
      }}
    >
      {interpolate(row[lang], { machines: machines.map(m => m.name).join(', ') })}
    </span>
  )
}
