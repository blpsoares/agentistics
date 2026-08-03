import { normalizeEndpointKey, type TeamConfig, type TeamConnection } from '@agentistics/core'

/**
 * Which stored connection is the single-connection Settings panel actually looking at?
 *
 * That panel (`components/TeamSettings.tsx`) predates `connections[]` and renders the legacy flat
 * mirror, which `normalizeTeamConfig` always builds from `connections[0]` — so the endpoint on
 * screen belongs to a real entry and can be mapped back to its id. That id is what lets Disconnect
 * call `DELETE /api/team/connections/:id` and remove ONE central, instead of PUTting a solo `team`
 * object whose `connections: []` key wipes every connection and every token on the machine.
 *
 * Matching goes through `normalizeEndpointKey` (the one shared endpoint identity rule) rather than a
 * string compare, and falls back to "the only connection there is". With several connections and NO
 * match it returns `undefined` on purpose: a caller that guessed `connections[0]` would disconnect a
 * central the user is not looking at — the same "never guess" rule `agentop member leave` follows in
 * its non-TTY branch.
 *
 * Pure.
 */
export function findPanelConnection(cfg: TeamConfig, endpoint: string): TeamConnection | undefined {
  const conns = cfg.connections ?? []
  const key = normalizeEndpointKey(endpoint ?? '')
  if (key) {
    const hit = conns.find(c => normalizeEndpointKey(c.endpoint) === key)
    if (hit) return hit
  }
  return conns.length === 1 ? conns[0] : undefined
}
