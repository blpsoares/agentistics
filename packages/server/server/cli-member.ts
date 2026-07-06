/**
 * cli-member.ts — configure this machine as a Team Member from the CLI, no browser.
 *
 * memberConnect resolves the display name from the central's whoami endpoint,
 * then persists preferences.team = { mode:'member', … }. memberLeave best-effort
 * notifies the central then resets to solo. memberStatus prints the current
 * config plus the live uploader status. The bearer token is never logged.
 */

import { DEFAULT_TEAM } from '@agentistics/core'
import { PORT } from './config'
import { readPreferences, writePreferences, type Preferences } from './preferences'
import { getUploaderStatus } from './team-uploader'

/**
 * If a server is already running on this machine, nudge it to act on a just-changed team config
 * immediately: PUT the team block so its handler opens the reverse-channel WebSocket and pushes
 * now, instead of waiting for the next ~5 s poll. Best-effort — a no-op when no server is up.
 */
async function nudgeLocalServer(team: NonNullable<Preferences['team']>): Promise<void> {
  try {
    await fetch(`http://localhost:${PORT}/api/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team }),
      signal: AbortSignal.timeout(3_000),
    })
  } catch { /* no local server running (or unreachable) — the config on disk still takes effect */ }
}

export interface MemberConnectOptions {
  endpoint: string
  token: string
  org?: string
}

interface WhoamiResponse {
  ok?: boolean
  user?: string
  org?: string
}

/**
 * Connect this machine to a central as a member. Verifies the token via
 * GET <endpoint>/api/team/whoami (Bearer), then writes preferences on success.
 * Returns 0 on success, non-zero (with an actionable message) on failure.
 */
export async function memberConnect(opts: MemberConnectOptions): Promise<number> {
  const endpoint = (opts.endpoint ?? '').trim().replace(/\/+$/, '')
  const token = (opts.token ?? '').trim()

  if (!endpoint) {
    process.stderr.write('member connect needs --endpoint <url>.\n')
    return 1
  }
  if (!token) {
    process.stderr.write('member connect needs --token <token>.\n')
    return 1
  }

  let whoami: WhoamiResponse | null = null
  try {
    const res = await fetch(`${endpoint}/api/team/whoami`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      whoami = (await res.json()) as WhoamiResponse
    }
  } catch (err) {
    process.stderr.write(
      `Could not reach the central at ${endpoint}: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return 1
  }

  if (!whoami || !whoami.ok || !whoami.user) {
    process.stderr.write(
      "the central didn't recognize this token — mint one in its Team Manager.\n",
    )
    return 1
  }

  const resolvedUser = whoami.user
  const resolvedOrg = opts.org?.trim() || whoami.org || 'default'

  const team: NonNullable<Preferences['team']> = {
    ...DEFAULT_TEAM,
    mode: 'member',
    endpoint,
    token,
    org: resolvedOrg,
    user: resolvedUser,
  }
  await writePreferences({ team })
  // If a server is already running locally, make it connect + push immediately.
  await nudgeLocalServer(team)

  process.stdout.write(`connected as ${resolvedUser}\n`)
  return 0
}

/**
 * Leave the central: best-effort POST <endpoint>/api/team/leave with the Bearer
 * token so the central drops this member's data, then reset preferences to solo.
 * Always returns 0 (leaving locally must succeed even if the central is down).
 */
export async function memberLeave(): Promise<number> {
  const prefs = await readPreferences()
  const team = prefs.team

  if (!team || team.mode !== 'member') {
    process.stdout.write('not connected to a central — nothing to leave.\n')
    return 0
  }

  const endpoint = (team.endpoint ?? '').replace(/\/+$/, '')
  if (endpoint) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (team.token) headers['Authorization'] = `Bearer ${team.token}`
    try {
      await fetch(`${endpoint}/api/team/leave`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ org: team.org, user: team.user }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch { /* best-effort — leaving locally proceeds regardless */ }
  }

  await writePreferences({ team: { ...DEFAULT_TEAM } })
  process.stdout.write('left the central\n')
  return 0
}

/** Print the current team mode/endpoint/user and, if member, the uploader status. */
export async function memberStatus(): Promise<number> {
  const prefs = await readPreferences()
  const team = prefs.team ?? { ...DEFAULT_TEAM }

  process.stdout.write(`mode:     ${team.mode}\n`)
  if (team.mode === 'member') {
    process.stdout.write(`endpoint: ${team.endpoint || '(none)'}\n`)
    process.stdout.write(`org:      ${team.org || 'default'}\n`)
    process.stdout.write(`user:     ${team.user || '(unknown)'}\n`)

    const status = getUploaderStatus()
    const last = status.lastSuccessAt
      ? new Date(status.lastSuccessAt).toISOString()
      : 'never'
    const err =
      status.errKind === 'auth' ? 'token rejected by central' :
      status.errKind === 'net' ? 'central unreachable' :
      'ok'
    process.stdout.write(`last sync: ${last}\n`)
    process.stdout.write(`state:     ${err}\n`)
  }
  return 0
}
