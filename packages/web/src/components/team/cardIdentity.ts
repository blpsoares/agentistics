/**
 * cardIdentity.ts — PURE: which name goes where on a connection card.
 *
 * The product rule this exists to hold: **a machine's name is assigned by the CENTRAL and never
 * by the machine.** The central puts it on the minted token and the machine reads it back through
 * `GET /api/team/whoami` (forwarded to the card by the connection probe as `machineName`). Nothing
 * on this machine may write it, and — the part that used to be wrong — nothing on this machine may
 * MASK it either: the card's title was `conn.label ?? (… identity.machineName …)`, so a locally
 * stored nickname displaced the central's own name for the machine and the machine appeared to
 * have renamed itself.
 *
 * The nickname stays (a fleet of centrals needs telling apart) but it names the CONNECTION — that
 * central — and is never a source for the machine name, not even as a fallback. The central's own
 * line prefers, after that nickname, the ORG the central reports for itself: "siths" is what a
 * person calls that central, while `100.109.247.39:48080` is only where it answers. When the central's
 * name is not known yet (an older central, or the probe has not run: it fires on expand) the
 * machine falls back to the endpoint HOST, which is a fact about the connection and cannot be
 * mistaken for a name this machine chose.
 *
 * `user` is the ACCOUNT the token authenticates as. Machine, central and account are three
 * different things and are returned as three fields so the card can label each — never one
 * conflated string.
 */

import { isNamedOrg } from '@agentistics/core'

export interface CardIdentityInput {
  /** The name the CENTRAL gave this machine (probe → `whoami`). Absent until the probe resolves. */
  machineName?: string
  /** Purely-local nickname for THIS CONNECTION / that central. Never names the machine. */
  label?: string
  /** The organisation the central reports for itself (`GET /api/team/whoami` → `org`, mirrored on
   *  `GET /api/team/status`). A NAME for the central — unlike the host, which is an address. */
  org?: string
  /** Host of the connection endpoint (`hostOf(conn.endpoint)`), always available. */
  host: string
  /** The account the token authenticates as, per the central. */
  user?: string
  /** Another connection on this panel resolves to the same host. */
  duplicateHost: boolean
}

export interface CardIdentity {
  /** The machine's name as the central assigned it, or the endpoint host. Never the nickname. */
  machine: string
  /** Where `machine` came from — 'host' means "the central has not told us yet", not a name. */
  machineSource: 'central' | 'host'
  /** The name of the central this connection points at: the local nickname, else its org, else
   *  the endpoint host. */
  central: string
  /** Where `central` came from — 'host' means "nobody has given this central a name", an address
   *  standing in for one, not a name. */
  centralSource: 'label' | 'org' | 'host'
  /** The account, or `''` when the central has not resolved one yet. */
  user: string
}

function clean(s: string | undefined): string {
  return (s ?? '').trim()
}

/**
 * `TEAM_ORG` defaults to the literal string `default` (`config.ts`), so most centrals report it
 * without anyone having chosen it. Titling every card "default" would make a fleet of centrals
 * indistinguishable — strictly worse than the addresses the org replaces — so the placeholder is
 * not treated as a name at all. Case-folded: the same non-choice typed in capitals is still one.
 *
 * `isNamedOrg` now lives in `@agentistics/core/org`, because the central asks the same question
 * when it decides whether to create a team named after the organisation. One placeholder rule,
 * two readers.
 */
export function resolveCardIdentity(input: CardIdentityInput): CardIdentity {
  const machineName = clean(input.machineName)
  const label = clean(input.label)
  const host = clean(input.host)
  const org = clean(input.org)
  const user = clean(input.user)

  // The central's NAME, most-explicit first: the nickname the user typed for this connection, then
  // the org the central reports for itself, then — only because nobody has named it — its address.
  // The org is never a source for the MACHINE name: that one is the central's to assign and is
  // resolved on its own line below.
  const centralSource: CardIdentity['centralSource'] = label ? 'label' : isNamedOrg(org) ? 'org' : 'host'
  const named = centralSource === 'label' ? label : centralSource === 'org' ? org : host

  // Two connections to the same host describe the SAME machine, so the machine name distinguishes
  // nothing there; the account does. Disambiguation therefore lands on the CENTRAL line, and only
  // when the user has not already named that central themselves.
  const central = centralSource === 'label' || !(input.duplicateHost && user) ? named : `${named} · ${user}`

  return {
    machine: machineName || host,
    machineSource: machineName ? 'central' : 'host',
    central,
    centralSource,
    user,
  }
}
