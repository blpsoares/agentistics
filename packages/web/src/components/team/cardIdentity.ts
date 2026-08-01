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
 * central — and is never a source for the machine name, not even as a fallback. When the central's
 * name is not known yet (an older central, or the probe has not run: it fires on expand) the
 * machine falls back to the endpoint HOST, which is a fact about the connection and cannot be
 * mistaken for a name this machine chose.
 *
 * `user` is the ACCOUNT the token authenticates as. Machine, central and account are three
 * different things and are returned as three fields so the card can label each — never one
 * conflated string.
 */

export interface CardIdentityInput {
  /** The name the CENTRAL gave this machine (probe → `whoami`). Absent until the probe resolves. */
  machineName?: string
  /** Purely-local nickname for THIS CONNECTION / that central. Never names the machine. */
  label?: string
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
  /** The name of the central this connection points at: the local nickname, else the host. */
  central: string
  /** The account, or `''` when the central has not resolved one yet. */
  user: string
}

function clean(s: string | undefined): string {
  return (s ?? '').trim()
}

export function resolveCardIdentity(input: CardIdentityInput): CardIdentity {
  const machineName = clean(input.machineName)
  const label = clean(input.label)
  const host = clean(input.host)
  const user = clean(input.user)

  // Two connections to the same host describe the SAME machine, so the machine name distinguishes
  // nothing there; the account does. Disambiguation therefore lands on the CENTRAL line, and only
  // when the user has not already named that central themselves.
  const central = label || (input.duplicateHost && user ? `${host} · ${user}` : host)

  return {
    machine: machineName || host,
    machineSource: machineName ? 'central' : 'host',
    central,
    user,
  }
}
