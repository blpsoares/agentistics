/**
 * capability-guard.ts — maps a request path to the local capability it needs, and turns a
 * revoked capability into a 403.
 *
 * Kept separate from index.ts so the mapping is unit-testable and so a newly added local-power
 * route is a one-line registration instead of a scattered `if`.
 *
 * SECURITY: these routes execute shell commands, spawn coding-assistant CLIs, read the host's
 * raw conversation transcripts, or rewrite ~/.claude.json. They must be unreachable on an
 * internet-exposed instance regardless of who is authenticated — a `member` account is not a
 * reason to hand out a shell. A route that is NOT registered here is assumed harmless, so a
 * missed registration is a vulnerability, not an oversight.
 */
import { CAPS, type Capabilities } from './exposure'

/** Exact path → capability. Detail sub-paths are handled by the prefix table below. */
const EXACT: ReadonlyMap<string, keyof Capabilities> = new Map<string, keyof Capabilities>([
  ['/api/exec', 'localShell'],
  ['/api/chat-tty', 'localChat'],
  ['/api/chat-harnesses', 'localChat'],
  ['/api/mcp-list', 'mcpAdmin'],
  ['/api/mcp-action', 'mcpAdmin'],
  ['/api/projects-list', 'localTranscripts'],
  // Returns this machine's decrypted sibling messages — a peer's FULL source list, plus its own
  // key fingerprints. Strictly more sensitive than /api/team/status, which deliberately exposes
  // only counts, so it is host-local data and must be unreachable on an exposed instance.
  ['/api/team/proposals', 'localTranscripts'],
  // Reads ~/.claude.json, ~/.claude/settings*.json and ~/.claude/.credentials.json to propose how
  // this machine is billed. It extracts only non-secret fields, but the ANSWER is still host
  // configuration and the files are the most sensitive this product touches, so it rides the same
  // capability as the transcript routes rather than getting one of its own: there is no
  // deployment that should read a transcript but not this.
  ['/api/billing/detect', 'localTranscripts'],
  ['/api/hardware-resources', 'localProcesses'],
  // The session fleet, and acting on it. `/api/fleet` alone captures each live session's SCREEN —
  // a coding assistant's terminal, transcript and all — and `/api/fleet/act` types into it, sends
  // it a keystroke that answers a permission prompt, or kills it. That is shell access with extra
  // steps, so it rides `localShell` rather than the softer `localChat`: there is no deployment
  // that should expose someone's keyboard to the internet and a shell is the honest name for it.
  ['/api/fleet', 'localShell'],
  ['/api/fleet/act', 'localShell'],
  // The live terminal channel — an SSE stream of a session's SCREEN, colours and all. It is a read,
  // but it is a read of a coding assistant's terminal, so it rides the same `localShell` as
  // `/api/fleet`: there is no deployment that should stream someone's terminal to the internet.
  ['/api/fleet/stream', 'localShell'],
])

/** Prefix (no trailing slash) → capability. Matches `<prefix>` and `<prefix>/…` only. */
const PREFIXES: ReadonlyArray<readonly [string, keyof Capabilities]> = [
  ['/api/claude-sessions', 'localTranscripts'],
  ['/api/codex-sessions', 'localTranscripts'],
  ['/api/gemini-sessions', 'localTranscripts'],
  ['/api/copilot-sessions', 'localTranscripts'],
  ['/api/nay-sessions', 'localTranscripts'],
]

export function routeCapability(pathname: string): keyof Capabilities | null {
  const exact = EXACT.get(pathname)
  if (exact) return exact
  for (const [prefix, cap] of PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return cap
  }
  return null
}

/**
 * A ready 403 when the capability is off, or null when the call may proceed.
 * The caller spreads CORS_HEADERS over the response.
 */
export function capabilityDenied(
  cap: keyof Capabilities,
  caps: Capabilities = CAPS,
): Response | null {
  if (caps[cap]) return null
  return new Response(JSON.stringify({ error: 'capability_disabled', capability: cap }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}
