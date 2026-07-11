/**
 * ci-push.ts — one-shot metrics push for ephemeral GitHub Actions runners.
 *
 * A Claude Code GitHub Actions run is a short-lived "machine": it populates `~/.claude`, then
 * dies. `agentop ci-push` builds this run's session metrics from `~/.claude` and POSTs them once
 * to a central's `/api/team/ingest`, authenticated with a repo-bound CI token (a GitHub Actions
 * secret). The central stamps `git_remote` + `ci: true` from the token, so the run's usage lands
 * under the right repository and shows up in the Repositories → Actions view.
 *
 * Unlike the long-lived member uploader, this does NOT use the consolidate store or sent-state:
 * an ephemeral runner's `~/.claude` only holds the current run, and the central upserts
 * idempotently by session id, so pushing everything once is both correct and minimal.
 */

import { buildApiResponse } from './data'

export interface CiPushOpts {
  /** Central base URL, e.g. https://central.example.com:48080 (no trailing /api). */
  endpoint: string
  /** Repo-bound CI token minted by `POST /api/team/repos` (stored as a GitHub Actions secret). */
  token: string
  /** Org namespace on the central. Defaults to $AGENTISTICS_TEAM_ORG or 'default'. */
  org?: string
}

/**
 * Resolve options from explicit args first, then the conventional CI env vars, so the reusable
 * workflow can pass everything via `env:`:
 *   AGENTISTICS_CENTRAL_URL, AGENTISTICS_CI_TOKEN, AGENTISTICS_TEAM_ORG
 */
export function resolveCiPushOpts(partial: Partial<CiPushOpts>): CiPushOpts | { error: string } {
  const endpoint = (partial.endpoint || process.env.AGENTISTICS_CENTRAL_URL || '').replace(/\/+$/, '')
  const token = partial.token || process.env.AGENTISTICS_CI_TOKEN || ''
  const org = partial.org || process.env.AGENTISTICS_TEAM_ORG || 'default'
  if (!endpoint) return { error: 'central URL required (--endpoint or AGENTISTICS_CENTRAL_URL)' }
  if (!token) return { error: 'CI token required (--token or AGENTISTICS_CI_TOKEN)' }
  return { endpoint, token, org }
}

/**
 * Build this run's metrics and push them to the central once. Returns an exit code (0 = ok).
 * Never throws — CI steps should not fail the whole workflow because analytics were unreachable
 * (the push is best-effort observability, not part of the build).
 */
export async function runCiPush(partial: Partial<CiPushOpts>): Promise<number> {
  const resolved = resolveCiPushOpts(partial)
  if ('error' in resolved) {
    console.error(`[ci-push] ${resolved.error}`)
    return 1
  }
  const { endpoint, token, org } = resolved

  let sessions
  let statsCache
  try {
    const data = await buildApiResponse()
    sessions = data.sessions
    statsCache = data.statsCache
  } catch (e) {
    console.error(`[ci-push] failed to read local metrics: ${e instanceof Error ? e.message : String(e)}`)
    return 0 // don't fail the CI job over analytics
  }

  if (!sessions || sessions.length === 0) {
    console.log('[ci-push] no sessions found in ~/.claude — nothing to push')
    return 0
  }

  // `user` is authoritative from the token (github-actions); we send a placeholder so the body
  // passes validation. `git_remote` + `ci` are stamped server-side from the repo token.
  const body = JSON.stringify({ org, user: 'github-actions', sessions, statsCache })
  try {
    const res = await fetch(`${endpoint}/api/team/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body,
    })
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { count?: number }
      console.log(`[ci-push] pushed ${json.count ?? sessions.length} session(s) to ${endpoint}`)
      return 0
    }
    if (res.status === 401 || res.status === 403) {
      console.error(`[ci-push] central rejected the CI token (${res.status}) — is the repo registered?`)
    } else {
      console.error(`[ci-push] central returned ${res.status}`)
    }
    return 0 // still don't fail the job
  } catch (e) {
    console.error(`[ci-push] could not reach central: ${e instanceof Error ? e.message : String(e)}`)
    return 0
  }
}
