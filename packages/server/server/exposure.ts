/**
 * exposure.ts — the single source of truth for "how reachable is this instance?".
 *
 * Every dangerous capability (local shell, local chat, host transcript reads, MCP admin) asks
 * this module instead of re-deriving the answer from env vars at the call site. The decision
 * functions are pure and unit-tested; the runtime singletons at the bottom are the only IO.
 *
 * Profiles:
 *   local  — solo machine on 127.0.0.1. Full local power, no auth (today's behaviour).
 *   lan    — a central reachable from a trusted network (LAN/Tailscale). Auth on, local power
 *            off unless explicitly opted in.
 *   public — a central published on the internet. Local power is unavailable, period: there is
 *            no opt-in for arbitrary shell on an instance strangers can reach.
 *
 * Fail-closed: an unrecognised AGENTISTICS_EXPOSURE value resolves to `public`.
 */

export type ExposureProfile = 'local' | 'lan' | 'public'

export interface ExposureEnv {
  central: boolean
  exposure: string | undefined
  allowLocalShell: boolean
  tls: boolean
}

export interface Capabilities {
  /** POST /api/exec — arbitrary shell on the host. */
  localShell: boolean
  /** POST /api/chat-tty — spawns a coding-assistant CLI on the host. */
  localChat: boolean
  /** GET /api/{claude,codex,gemini,copilot,nay}-sessions — reads host transcripts. */
  localTranscripts: boolean
  /** POST /api/mcp-action — mutates the host's ~/.claude.json. */
  mcpAdmin: boolean
  /** Owner accounts must have TOTP enrolled before they can use the instance. */
  requireMfaForOwner: boolean
  /** Session cookies must carry Secure + the __Host- prefix. */
  requireSecureCookies: boolean
}

export function resolveProfile(env: ExposureEnv): ExposureProfile {
  if (env.exposure === undefined || env.exposure === '') return env.central ? 'lan' : 'local'
  if (env.exposure === 'local' || env.exposure === 'lan' || env.exposure === 'public') return env.exposure
  return 'public' // unknown value → most restrictive
}

export function capabilitiesFor(profile: ExposureProfile, env: ExposureEnv): Capabilities {
  if (profile === 'local') {
    return {
      localShell: true,
      localChat: true,
      localTranscripts: true,
      mcpAdmin: true,
      requireMfaForOwner: false,
      requireSecureCookies: false,
    }
  }
  if (profile === 'lan') {
    return {
      localShell: env.allowLocalShell,
      localChat: env.allowLocalShell,
      localTranscripts: env.allowLocalShell,
      mcpAdmin: env.allowLocalShell,
      requireMfaForOwner: false,
      requireSecureCookies: env.tls,
    }
  }
  return {
    localShell: false,
    localChat: false,
    localTranscripts: false,
    mcpAdmin: false,
    requireMfaForOwner: true,
    requireSecureCookies: true,
  }
}

// ---------------------------------------------------------------------------
// Runtime singletons. Read straight from process.env (not config.ts) so this module
// stays importable from anywhere without pulling in the filesystem-touching config chain.
// ---------------------------------------------------------------------------

export const EXPOSURE_ENV: ExposureEnv = {
  central: process.env.AGENTISTICS_TEAM_CENTRAL === '1',
  exposure: process.env.AGENTISTICS_EXPOSURE,
  allowLocalShell: process.env.AGENTISTICS_ALLOW_LOCAL_SHELL === '1',
  tls: process.env.AGENTISTICS_TEAM_TLS === '1',
}

export const PROFILE: ExposureProfile = resolveProfile(EXPOSURE_ENV)
export const CAPS: Capabilities = capabilitiesFor(PROFILE, EXPOSURE_ENV)
