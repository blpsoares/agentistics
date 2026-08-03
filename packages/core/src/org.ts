/**
 * org.ts — PURE: when is the configured org an actual NAME, and when is it the placeholder?
 *
 * `TEAM_ORG` (`config.ts`) defaults to the literal string `default`, so most centrals report an org
 * nobody ever chose. Anything that turns the org into something a person reads — a connection
 * card's title, a team created for the organisation — has to tell the two apart, or it presents a
 * non-choice as a decision: a fleet of centrals all titled "default", or a team named "default"
 * that names nothing.
 *
 * The rule lived in `web/src/components/team/cardIdentity.ts` and is now shared, so the server side
 * cannot answer the same question differently. Case-folded and trimmed: the same non-choice typed
 * in capitals, or with a stray space from a copy-pasted env file, is still the same non-choice.
 */

export const PLACEHOLDER_ORG = 'default'

/** True when `org` is a name someone actually chose (not empty, not the `default` placeholder). */
export function isNamedOrg(org: string | undefined | null): boolean {
  const trimmed = (org ?? '').trim()
  return trimmed !== '' && trimmed.toLowerCase() !== PLACEHOLDER_ORG
}
