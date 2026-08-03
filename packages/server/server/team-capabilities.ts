/**
 * team-capabilities.ts — what a central can do, advertised on GET /api/team/policy.
 *
 * The removal primitive was assembled across releases (`/api/team/leave` + deleteMemberStats in
 * v1.6.6, deleteMemberWorkflows only in v1.7.3, `forget` here), so a member cannot infer a
 * central's vintage from its version string alone and must not try. Additive by design: an older
 * member ignores the field, and an older CENTRAL omits it — which is why the reader below treats
 * absence as "no capabilities" rather than assuming any.
 */

/** What THIS central advertises. Add a string here the same release the route ships, never before. */
export const CENTRAL_CAPABILITIES: readonly string[] = [
  'leave',
  'leave.stats',
  'leave.workflows',
  'forget.sessions',
]

/** Pure, total: any shape that is not an array of strings reads as no capabilities. */
export function parseCapabilities(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string')
}

/** The one capability this feature gates on. `false` DISABLES the rules editor (§7) — it never
 *  selects a fallback: emptying a machine's history to withdraw a handful of sessions is not an
 *  acceptable substitute for a precise delete the central cannot perform. */
export function centralCanForget(caps: readonly string[]): boolean {
  return caps.includes('forget.sessions')
}
