/**
 * central-reach.ts — PURE: "who will reach this central?" translated into the four variables that
 * answer it.
 *
 * The setup wizard used to ask for a BIND_IP and stop there, which left the single most consequential
 * setting on a central — `AGENTISTICS_EXPOSURE` — reachable only by hand-editing `central.env` after
 * reading a document. Someone who deployed a central and pointed a tunnel at it therefore got the
 * `lan` profile, silently, because that is what a central defaults to when nothing says otherwise.
 *
 * ## Why this is a setting at all
 *
 * It looks like it should be automatic — an API does not have a switch for "am I on the internet",
 * it simply is. The difference is what a central CAN DO, not who can call it.
 *
 * A central shares its code with a solo machine's dashboard, and that dashboard legitimately runs
 * shell on its own host (`/api/exec`), spawns the local assistant CLI (`/api/chat-tty`), reads the
 * machine's raw transcripts and rewrites `~/.claude.json`. Those are correct on your own laptop and
 * catastrophic on a box strangers can reach. So the question is not "expose me" — it is "which of my
 * capabilities should still exist, given who can get here".
 *
 * And it cannot be inferred. From inside the container, a central behind a Cloudflare tunnel and a
 * central nobody can reach are IDENTICAL: both see a loopback bind, the same request headers, the
 * same everything. The tunnel is outside the process, often on another host. Only the operator knows
 * the intent, so only the operator can state it — which means the wizard must ASK, and it is a
 * defect that it did not.
 *
 * ## The mapping
 *
 * `BIND_IP` and `AGENTISTICS_EXPOSURE` are separate settings that answer to one intent, which is why
 * they are decided together here rather than asked as two unrelated questions the user has to keep
 * consistent by hand. In particular `internet` implies LOOPBACK, not a wider bind: the whole point is
 * that the tunnel or proxy is the only way in, and widening the bind beside it adds a second door
 * that bypasses every control at the edge.
 */

/** Who the operator intends to be able to reach this central. */
export type CentralReach = 'this-host' | 'trusted-network' | 'internet'

export const CENTRAL_REACHES: readonly CentralReach[] = ['this-host', 'trusted-network', 'internet']

/** The exposure profile `exposure.ts` understands. */
export type ExposureProfile = 'local' | 'lan' | 'public'

/** What a reach answer means, in the variables `central.env` actually carries. */
export interface ReachSettings {
  exposure: ExposureProfile
  /** Suggested `BIND_IP`. The user may still override it; this is the default the prompt offers. */
  bind: string
  /** `AGENTISTICS_TEAM_TLS` — TLS terminates in front of this instance. */
  tls: boolean
  /**
   * `AGENTISTICS_TRUST_PROXY` — believe `CF-Connecting-IP` / `X-Forwarded-For`.
   *
   * True ONLY alongside a loopback bind, which is what makes the proxy provably the sole way in.
   * Set it while the app is also reachable directly and a client picks its own rate-limit bucket by
   * sending the header, which is worse than not trusting the proxy at all.
   */
  trustProxy: boolean
}

export function settingsForReach(reach: CentralReach): ReachSettings {
  switch (reach) {
    case 'this-host':
      return { exposure: 'local', bind: '127.0.0.1', tls: false, trustProxy: false }
    case 'trusted-network':
      // A LAN or a tailnet: auth is on, host-power routes are off unless explicitly opted into,
      // and TLS is usually absent (a tailnet encrypts for you; a LAN commonly does not bother).
      return { exposure: 'lan', bind: '0.0.0.0', tls: false, trustProxy: false }
    case 'internet':
      // Loopback DELIBERATELY. The entry point in front is the only way in, which is the property
      // every other control on a published central assumes.
      return { exposure: 'public', bind: '127.0.0.1', tls: true, trustProxy: true }
  }
}

/**
 * The reach that best describes an EXISTING configuration, so re-running the wizard defaults to what
 * the central already is rather than to a fresh install's answer.
 *
 * The profile leads, because it is the deliberate setting; the bind is only consulted when no
 * profile was ever written. An absent profile on a central means `lan` (that is what `exposure.ts`
 * resolves), but a central whose bind is loopback is far more likely to be a local one that never
 * answered this question — so it reads as `this-host` and the prompt offers that, rather than
 * proposing to widen a machine nobody asked to widen.
 */
export function reachOfExisting(env: { exposure?: string; bind?: string }): CentralReach | undefined {
  const profile = (env.exposure ?? '').trim()
  if (profile === 'public') return 'internet'
  if (profile === 'lan') return 'trusted-network'
  if (profile === 'local') return 'this-host'
  if (profile !== '') return undefined // an unrecognised value: say nothing rather than guess
  const bind = (env.bind ?? '').trim()
  if (bind === '') return undefined
  return bind === '127.0.0.1' || bind === 'localhost' ? 'this-host' : 'trusted-network'
}

/**
 * Whether a chosen bind CONTRADICTS the chosen reach, and what to say about it.
 *
 * The user may override the suggested bind, and one combination is a real mistake rather than a
 * preference: publishing on the internet while also binding every interface. That is the second door
 * the topology exists to avoid — every control at the edge can be walked around by addressing the
 * host directly. It is a WARNING, not a refusal: someone may genuinely be fronting the app with
 * something on another machine, and a wizard that refuses a valid deployment is worse than one that
 * says what it thinks.
 */
export function bindWarning(reach: CentralReach, bind: string): string | null {
  const b = bind.trim()
  if (reach !== 'internet') return null
  if (b === '127.0.0.1' || b === 'localhost' || b === '') return null
  if (b === '0.0.0.0') {
    return 'Publishing on the internet with BIND_IP=0.0.0.0 means the app is ALSO reachable directly, ' +
      'bypassing whatever you put in front of it — including its rate limiting and any auth layer ' +
      'there. Prefer 127.0.0.1 unless the tunnel or proxy runs on a different machine.'
  }
  return `BIND_IP=${b} is reachable beyond this host, so the entry point in front is not the only ` +
    'way in. That is only correct when the tunnel or proxy runs on another machine and reaches this ' +
    'one over that address.'
}
