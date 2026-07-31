// embeddedDist is loaded inside server/sse.ts (conditional on SERVE_STATIC=1)

import { readFile } from 'node:fs/promises'
import { PORT, WEB_PORT, TEAM_CENTRAL, TEAM_PASSWORD, TEAM_ORG, INGEST_ONLY } from './config'
import type { Server, ServerWebSocket } from 'bun'
import type { LiveProcess } from '@agentistics/core'
import { getRates } from './rates'
import { getVersionInfo, startVersionRecheck } from './version'
import { buildApiResponse, buildApiResponseStream, invalidateCache } from './data'
import { readPreferences, writePreferences, redactPreferences, guardTeamConnectionsWipe, PreferencesLockTimeoutError, type Preferences } from './preferences'
import {
  readStoredNotifications, addStoredNotification, markStoredNotificationsRead,
  dismissStoredNotification, clearStoredNotifications, localViewer, type NotificationInput,
} from './notifications-store'
import { streamViaClaude, execCommand, ensureNayChat, ensureClaudeChat, CLAUDE_CHAT_DIR, type ChatMessage, type ChatModelId, type ChatAttachment } from './chat-tty'
import { getChatDriver, chatHarnessStatus } from './chat-drivers/index'
import { listMcpServers, removeMcpServer } from './mcp-list'
import { listNaySessions, getNaySessionMessages } from './nay-sessions'
import { listClaudeSessions, getClaudeSessionMessages, type ClaudeSessionSummary, type ClaudeSessionMessage } from './claude-sessions'
import { listCodexSessions, getCodexSessionMessages, type CodexSessionSummary, type CodexSessionMessage } from './codex-sessions'
import { listGeminiSessions, getGeminiSessionMessages, type GeminiSessionSummary, type GeminiSessionMessage } from './gemini-sessions'
import { listCopilotSessions, getCopilotSessionMessages, type CopilotSessionSummary, type CopilotSessionMessage } from './copilot-sessions'
import { PROJECTS_DIR } from './config'
import { safeReadDir } from './utils'
import { decodeProjectDir } from './git'
import { getEnabledAdapters } from './adapters/types'
import { handleLogout, handleSession, getPrincipal, getPrincipalSession, makePrincipalSessionCookieHeader, SESSION_REFRESH_MS } from './auth'
import { routeCapability, capabilityDenied } from './capability-guard'
import { AUTH_PUBLIC, isAdminPath, MFA_EXEMPT } from './index-routes'
import { CAPS, PROFILE } from './exposure'
import { limiter, RULES, rateRuleFor, tooManyRequests } from './rate-limit'
import { resolveClientIp } from './client-ip'
import { corsHeadersFor } from './cors'
import { csrfVerdict } from './csrf'
import { securityHeaders } from './security-headers'
import { TRUST_PROXY, ALLOWED_ORIGINS, TEAM_TLS, TEAM_SESSION_SECRET_ENV, TEAM_SESSION_SECRET, setResolvedSessionSecret } from './config'
import { validateSecret, ensureSessionSecret } from './secret-store'
import { requiresStepUp, verifyStepUp, STEPUP_HEADER } from './stepup'
import { writeAudit, ensureAuditIndexes, listAudit } from './audit'
import { safeError } from './errors'
import { LIMITS } from './limits'
import { canSeeMemberNames } from './iam-view'
import {
  readEnvConfig,
  writeEnvConfig,
  readEnvConfigBackup,
  restoreEnvConfig,
  CONFIG_FIELDS,
} from './env-config'
import {
  sseClients,
  sseEncoder,
  setupFileWatcher,
  maybeSpawnWatcher,
  serveStatic,
  SERVE_STATIC,
  triggerSseNotification,
  notifySseClients,
} from './sse'
import { fullSync } from './archive'
import { getArchiveMode } from './preferences'
import { registerAgent, unregisterAgent, onAgentMessage, onAgentPong, setPresenceChangeHook } from './team-agent'
import { startAgentClient, reconcileNow } from './team-agent-client'
import { validateIngestToken } from './team-tokens'
import { getAccount } from './accounts'
import { getTeam } from './teams'

// ---------------------------------------------------------------------------
// Reads the first `cwd` field found in a JSONL session file.
// Used by /api/projects-list to get the real project path without ambiguous decoding.
// ---------------------------------------------------------------------------
async function readCwdFromJsonl(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, 'utf-8')
    for (const raw of content.split('\n').slice(0, 100)) {
      const line = raw.trim()
      if (!line) continue
      try {
        const e = JSON.parse(line)
        if (typeof e.cwd === 'string' && e.cwd) return e.cwd
      } catch { /* skip */ }
    }
  } catch { /* file unreadable */ }
  return null
}

// ---------------------------------------------------------------------------
// Start file watching and optionally spawn the OTel watcher daemon
// ---------------------------------------------------------------------------

// Preserve history before Claude's next cleanup (transcripts > cleanupPeriodDays,
// default 30 days). 'full' mirrors raw files; both modes warm a build that persists
// the consolidated per-session metrics store.
void (async () => {
  const mode = await getArchiveMode()
  if (mode === 'full') {
    fullSync().catch(err => console.warn('[archive] startup sync failed:', String(err)))
  }
  // Warm the response cache at boot so the FIRST user request is served instantly instead of paying
  // the full cold build (tens of seconds on a busy central). Runs for every mode — non-'off' modes
  // also persist the consolidated per-session store as a side effect; 'off' just warms the cache.
  buildApiResponse().catch(err => console.warn('[startup] cache warm-up failed:', String(err)))
})()

// Once-per-install move of the legacy single-connection team state files into the
// per-connection layout (see team-migrate.ts). Never call this from readPreferencesFrom.
await import('./team-migrate').then(m => m.migrateTeamStateOnce()).catch(err =>
  console.warn('[team-migrate] state migration failed (will retry next boot):', err instanceof Error ? err.message : String(err)))

void setupFileWatcher()
if (TEAM_CENTRAL) {
  import('./team-watch').then(m => m.startTeamWatch()).catch(err => console.error('[team-watch] failed to start:', err))
  // Push an IMMEDIATE SSE update when a member connects/disconnects so the dashboard's
  // online/offline dots and the members panel refresh instantly. Presence is computed fresh
  // per request (not cached), so this needs no cache invalidation and no debounce.
  setPresenceChangeHook(() => notifySseClients())
}

// IAM bootstrap init (central only): ensure indexes + Default team, backfill teamId, and —
// when no owner exists yet — mint a one-time setup token and print it to the logs.
if (TEAM_CENTRAL) {
  // Resolve the session-signing secret before anything can mint a cookie. A bad explicit value
  // is fatal on purpose: booting with a session key equal to the shared dashboard password is
  // worse than not booting, because every account becomes forgeable and nobody notices.
  if (TEAM_SESSION_SECRET_ENV) {
    const v = validateSecret(TEAM_SESSION_SECRET_ENV, TEAM_PASSWORD)
    if (!v.ok) {
      console.error(`[server] refusing to start: AGENTISTICS_TEAM_SESSION_SECRET is invalid (${v.reason}).`)
      console.error('[server] generate one with: openssl rand -hex 32')
      process.exit(1)
    }
    setResolvedSessionSecret(TEAM_SESSION_SECRET_ENV)
  } else {
    // Bounded: the secret must be settled before any cookie is minted, but an unreachable
    // database must not keep the server from ever listening. On timeout we keep the
    // per-process random secret already in config.ts — safe, just not durable.
    try {
      const secret = await Promise.race([
        ensureSessionSecret(),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 10_000)),
      ])
      if (secret) {
        setResolvedSessionSecret(secret)
        console.log('[server] using the persisted random session secret (set AGENTISTICS_TEAM_SESSION_SECRET to pin your own).')
      } else {
        console.warn('[server] database unreachable — using a per-process session secret; sessions will not survive a restart.')
      }
    } catch {
      console.warn('[server] could not persist a session secret — using a per-process one; sessions will not survive a restart.')
    }
  }

  void (async () => {
    try {
      const { ensureAccountIndexes, hasAnyOwner, purgeUnknownTeamsFromAccounts } = await import('./accounts')
      const { backfillTokenTeamIds, purgeUnknownTeamsFromMachines } = await import('./team-tokens')
      const { backfillRepoTeamIds } = await import('./team-repos')
      await ensureAccountIndexes()
      // Convert any date still stored as a STRING into a BSON Date. Runs before everything that
      // reads a timestamp, is idempotent (a migrated DB matches no documents), and never throws —
      // a central must still boot when it cannot run. See mongo-dates.ts.
      try {
        const { migrateStringDatesToBson } = await import('./mongo-dates')
        const { getMongoDb } = await import('./mongo')
        const changed = await migrateStringDatesToBson(await getMongoDb(), { log: m => console.log(m) })
        if (changed.length > 0) {
          const total = changed.reduce((n, r) => n + r.converted, 0)
          const stuck = changed.reduce((n, r) => n + r.unconvertible, 0)
          console.log(`[mongo-dates] migrated ${total} string date(s) to BSON Date` +
            (stuck > 0 ? ` — ${stuck} value(s) were not parseable and were left untouched for inspection` : ''))
        }
      } catch (e) { console.warn('[mongo-dates] migration skipped:', e instanceof Error ? e.message : e) }
      await ensureAuditIndexes()
      // No Default team is seeded — machines/accounts are loose until assigned to real teams.
      await backfillTokenTeamIds()
      await backfillRepoTeamIds()
      // Retroactively purge references to deleted teams (orphaned before the delete-cascade existed).
      try {
        const { listTeams } = await import('./teams')
        const validTeamIds = (await listTeams()).map(t => t._id)
        await purgeUnknownTeamsFromMachines(validTeamIds)
        await purgeUnknownTeamsFromAccounts(validTeamIds)
      } catch { /* best-effort */ }
      if (!(await hasAnyOwner())) {
        const { getBootstrapDoc, generateBootstrapToken } = await import('./bootstrap')
        const existing = await getBootstrapDoc()
        if (!existing || existing.consumedAt || !existing.tokenHash) {
          const token = await generateBootstrapToken(new Date())
          console.log(
            '\n' +
            '========================================================\n' +
            '  agentistics — OWNER SETUP REQUIRED\n' +
            '  No owner account exists yet. Create it with this\n' +
            '  one-time setup token (POST /api/iam/bootstrap):\n\n' +
            `      ${token}\n\n` +
            '  Keep it secret. It is shown only once.\n' +
            '========================================================\n',
          )
        } else {
          // Deliberately NOT reissued here: a boot that minted a second token would silently
          // invalidate one the operator may still be holding. Name the command that does it.
          console.log(
            '\n[agentistics] Owner setup pending — a setup token was already issued (see earlier\n' +
            '  logs). Lost it? Reissue with:  ./central.sh setup-token\n' +
            '  (standalone: agentop central setup-token)\n',
          )
        }
      }
    } catch (err) {
      console.error('[agentistics] IAM bootstrap init skipped:', err instanceof Error ? err.message : err)
    }
  })()
}

import('./team-uploader').then(m => m.startUploader()).catch(err => console.error('[team-uploader] failed to start:', err))
startAgentClient()
maybeSpawnWatcher()
// Periodic best-effort re-check so a long-running daemon surfaces new releases
// without a page reload (broadcasts an SSE notification when an update appears).
try { startVersionRecheck() } catch (err) { console.warn('[version] recheck failed to start:', String(err)) }
ensureNayChat(PORT).catch(err => console.error('[nay-chat] failed to initialize:', err))
ensureClaudeChat().catch(err => console.error('[claude-chat] failed to initialize:', err))


// ---------------------------------------------------------------------------
// CORS is computed per request from the caller's Origin against an explicit allowlist
// (see cors.ts). The old wildcard `Access-Control-Allow-Origin: *` let any web page probe
// this instance from a victim's network. `corsHeadersFor` emits no ACAO at all for an
// unknown origin, which is the right answer for a same-origin dashboard.
// ---------------------------------------------------------------------------

// Route tables (AUTH_PUBLIC / ADMIN_PATHS / MFA_EXEMPT) live in index-routes.ts so the
// authorization regression suite can assert them without booting the server.

// ---------------------------------------------------------------------------
// Bun HTTP server
// ---------------------------------------------------------------------------

type WSData = { user: string; memberId: string; isAgent?: boolean }

// Shared WS + request handlers, so the binary can bind the SAME logic to two ports below:
// PORT (47291 = api + mcp) and WEB_PORT (47292 = the web dashboard you open).
const _wsHandlers = {
  open(ws: ServerWebSocket<WSData>) { if (!ws.data.isAgent) return; registerAgent(ws) },
  message(ws: ServerWebSocket<WSData>, msg: string | Buffer) { if (!ws.data.isAgent) return; onAgentMessage(ws, msg) },
  pong(ws: ServerWebSocket<WSData>) { if (!ws.data.isAgent) return; onAgentPong(ws) },
  close(ws: ServerWebSocket<WSData>) { if (!ws.data.isAgent) return; unregisterAgent(ws) },
}

/**
 * Outer handler: runs the router, then stamps the OWASP baseline security headers on whatever
 * it produced. Doing it here (rather than at ~60 individual call sites) means a newly added
 * route cannot forget them. SSE responses set their headers before the first flush, so
 * mutating `res.headers` afterwards is still safe.
 */
async function handleRequest(req: Request, server: Server<WSData>): Promise<Response | undefined> {
  const res = await handleRequestInner(req, server)
  if (!res) return res // WebSocket upgrade handed off
  const isApi = new URL(req.url).pathname.startsWith('/api/')
  for (const [k, v] of Object.entries(securityHeaders({ tls: TEAM_TLS, dev: !SERVE_STATIC, isApi }))) {
    res.headers.set(k, v)
  }
  // A sliding-session refresh recorded by the auth gate. Appended (not set) so a route that
  // issues its own cookie — login, logout — is never overwritten.
  const refreshed = refreshedCookies.get(req)
  if (refreshed) {
    refreshedCookies.delete(req)
    if (!res.headers.has('Set-Cookie')) res.headers.append('Set-Cookie', refreshed)
  }
  return res
}

/**
 * Per-request channel for a sliding-session cookie refresh: the auth gate decides, the outer
 * wrapper attaches. Keyed by the Request object (WeakMap) so concurrent requests never share
 * state and nothing leaks if a handler throws.
 */
const refreshedCookies = new WeakMap<Request, string>()

async function handleRequestInner(req: Request, server: Server<WSData>): Promise<Response | undefined> {
    const url = new URL(req.url)
    // Collapse repeated slashes in the path. A member whose endpoint has a trailing slash
    // builds URLs like `//api/team/ingest` / `//api/team/agent`; without this they'd miss the
    // exact-match API routes and silently fall through to the static handler (200, no ingest)
    // or fail the WS upgrade — making pushes/presence look fine while nothing lands.
    if (url.pathname.includes('//')) url.pathname = url.pathname.replace(/\/{2,}/g, '/')

    // Per-request CORS. Every `...CORS_HEADERS` spread below keeps working unchanged.
    const CORS_HEADERS = corsHeadersFor(req.headers.get('origin'), ALLOWED_ORIGINS, !SERVE_STATIC)

    /** JSON response carrying this request's CORS headers. */
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // ---------------------------------------------------------------------------
    // Ingest-only hardening: a public-facing central that accepts CI pushes but
    // exposes nothing else. Everything except POST /api/team/ingest → 404, so an
    // exposed instance leaks no dashboard, no data, no login — only a token-gated
    // write endpoint. Pair with a separate PRIVATE dashboard instance on the same Mongo.
    // POST /api/team/forget is allowed too: a machine pushing to a public ingest instance
    // must also be able to withdraw sessions it no longer shares, and the route is just as
    // token-gated (inside the handler) as ingest itself — 404ing it here would strand a
    // machine's crash-journaled removals against exactly the central it pushed them to.
    // ---------------------------------------------------------------------------
    if (INGEST_ONLY && !(
      (url.pathname === '/api/team/ingest' && req.method === 'POST') ||
      (url.pathname === '/api/team/forget' && req.method === 'POST')
    )) {
      return new Response('Not found', { status: 404, headers: CORS_HEADERS })
    }

    // The caller's real IP, resolved once per request. Forwarded headers are only believed
    // when AGENTISTICS_TRUST_PROXY=1 (see client-ip.ts) — otherwise the socket address wins.
    const clientIp = resolveClientIp({
      socketAddress: server.requestIP(req)?.address ?? null,
      headers: req.headers,
      trustProxy: TRUST_PROXY,
    })

    // ---------------------------------------------------------------------------
    // Rate limiting. Auth endpoints get the strict rule, token-bearing endpoints their own,
    // and everything else under /api a generous ceiling so a single client cannot scrape the
    // whole dataset in a loop. `unknown` IPs share one bucket on purpose — fail closed.
    // ---------------------------------------------------------------------------
    if (url.pathname.startsWith('/api/')) {
      const rule = rateRuleFor(url.pathname)
      const key = rule === RULES.api ? `ip:${clientIp}:api` : `ip:${clientIp}:${url.pathname}`
      const verdict = limiter.check(key, rule)
      if (!verdict.allowed) {
        if (rule === RULES.loginAttempts) void writeAudit({ action: 'rate.blocked', ip: clientIp, meta: { path: url.pathname } })
        const res = tooManyRequests(verdict.retryAfterSec)
        const headers = new Headers(res.headers)
        for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
        return new Response(res.body, { status: res.status, headers })
      }
    }

    // ---------------------------------------------------------------------------
    // CSRF defence in depth (see csrf.ts). SameSite=Strict is the first line; this rejects any
    // unsafe method that carries a session cookie without proving same-origin provenance.
    // Token-authenticated machine clients send no cookie and are exempt.
    // ---------------------------------------------------------------------------
    if (url.pathname.startsWith('/api/')) {
      const verdict = csrfVerdict({
        method: req.method,
        origin: req.headers.get('origin'),
        secFetchSite: req.headers.get('sec-fetch-site'),
        host: url.host,
        hasCookie: req.headers.has('cookie'),
        allowlist: ALLOWED_ORIGINS,
        dev: !SERVE_STATIC,
      })
      if (!verdict.ok) {
        return new Response(JSON.stringify({ error: 'csrf_blocked' }), {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    // ---------------------------------------------------------------------------
    // Local-capability guard. Routes that execute shell commands, spawn coding-assistant
    // CLIs, read the host's raw transcripts, or edit ~/.claude.json are unreachable
    // whenever the exposure profile revokes the capability (see exposure.ts). Checked
    // BEFORE auth on purpose: an exposed instance never even reveals whether the caller
    // is authenticated, and no account role can talk its way into a shell.
    // ---------------------------------------------------------------------------
    {
      const needed = routeCapability(url.pathname)
      if (needed) {
        const denied = capabilityDenied(needed)
        if (denied) {
          void writeAudit({ action: 'capability.denied', ip: clientIp, meta: { path: url.pathname, capability: needed } })
          return new Response(denied.body, {
            status: denied.status,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }
      }
    }

    // ---------------------------------------------------------------------------
    // Auth gate (Phase 5): account-principal auth on the central.
    // All /api/* routes require a valid account session except the public allowlist.
    // Static assets are always served (the SPA + login UI must load without auth).
    // ---------------------------------------------------------------------------
    if (TEAM_CENTRAL && url.pathname.startsWith('/api/') && !AUTH_PUBLIC.has(url.pathname)) {
      const session = await getPrincipalSession(req)
      if (!session) {
        return new Response(JSON.stringify({ error: 'auth required' }), { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }
      // Admin routes require the owner.
      if (isAdminPath(url.pathname) && session.principal.role !== 'owner') {
        void writeAudit({ action: 'authz.denied', ip: clientIp, actorId: session.principal.accountId, meta: { path: url.pathname } })
        return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
      }
      // On an internet-exposed instance an owner must hold a second factor: their account can
      // reach every team's data and every admin route, so a single leaked password would be the
      // whole instance. Until they enrol, only the enrolment and identity routes answer.
      if (CAPS.requireMfaForOwner && session.principal.role === 'owner' && !MFA_EXEMPT.has(url.pathname)) {
        const { isMfaEnabled } = await import('./mfa-store')
        if (!(await isMfaEnabled(session.principal.accountId).catch(() => true))) {
          return new Response(JSON.stringify({ error: 'mfa_enrollment_required' }), {
            status: 403,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }
      }
      // Step-up ("sudo mode"): a session cookie proves who you are, not that you are still at
      // the keyboard. Operations that destroy data or mint a credential additionally require a
      // fresh grant from POST /api/iam/stepup, presented in X-Stepup. This does not prevent a
      // cookie being stolen — it bounds what the theft is worth.
      if (requiresStepUp(req.method, url.pathname)) {
        const granted = verifyStepUp(
          req.headers.get(STEPUP_HEADER),
          session.principal.accountId,
          session.sessionVersion,
          TEAM_SESSION_SECRET,
          Date.now(),
        )
        if (!granted) {
          void writeAudit({
            action: 'stepup.missing',
            ip: clientIp,
            actorId: session.principal.accountId,
            meta: { path: url.pathname, method: req.method },
          })
          return new Response(JSON.stringify({ error: 'stepup_required' }), {
            status: 403,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }
      }
      // Sliding session: reissue the cookie periodically so an active user is never logged out
      // at the idle wall, while an abandoned session still dies IDLE_TIMEOUT_MS after last use.
      if (Date.now() - session.issuedAtMs > SESSION_REFRESH_MS) {
        refreshedCookies.set(req, makePrincipalSessionCookieHeader(session.principal.accountId, session.sessionVersion))
      }
    }


    if (url.pathname === '/api/events' && req.method === 'GET') {
      // Each SSE client holds a socket and a controller for as long as it stays connected, so an
      // unbounded count is a free way to exhaust the process (OWASP API4).
      if (sseClients.size >= LIMITS.sseClients) {
        return new Response(JSON.stringify({ error: 'too_many_streams' }), {
          status: 503,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          sseClients.add(controller)
          controller.enqueue(sseEncoder.encode('event: connected\ndata: {}\n\n'))

          req.signal.addEventListener('abort', () => {
            sseClients.delete(controller)
            try { controller.close() } catch { /* already closed */ }
          })
        },
      })

      return new Response(stream, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      })
    }

    if (url.pathname === '/api/health' && req.method === 'GET') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/api/version' && req.method === 'GET') {
      try {
        const info = await getVersionInfo()
        return new Response(JSON.stringify(info), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const safe = safeError(err, { verbose: PROFILE === 'local' })
        console.error(safe.logLine)
        return new Response(JSON.stringify(safe.body), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    // The pricing table itself, with per-model provenance. Separate from /api/rates (which the
    // dashboard polls for the BRL rate) so a table this size is only paid for when it is opened.
    if (url.pathname === '/api/pricing' && req.method === 'GET') {
      const { getRates, getPricingOrigins } = await import('./rates')
      const rates = await getRates()
      const { origins, communityFetchedAt, communityOk } = getPricingOrigins()
      const models = Object.entries(rates.pricing)
        .map(([id, price]) => ({ id, ...price, origin: origins[id] ?? 'builtin' }))
        .sort((a, b) => a.id.localeCompare(b.id))
      return new Response(JSON.stringify({
        models,
        fetchedAt: rates.fetchedAt,
        communityFetchedAt,
        communityOk,
        sources: {
          official: { label: 'Anthropic', url: 'https://platform.claude.com/docs/en/about-claude/pricing' },
          community: { label: 'LiteLLM', url: 'https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json' },
        },
      }), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }

    if (url.pathname === '/api/rates' && req.method === 'GET') {
      try {
        const rates = await getRates()
        return new Response(JSON.stringify({
          brlRate: rates.brlRate,
          pricing: rates.pricing,
          pricingSource: rates.pricingSource,
          fetchedAt: rates.fetchedAt,
        }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const safe = safeError(err, { verbose: PROFILE === 'local' })
        console.error(safe.logLine)
        return new Response(JSON.stringify(safe.body), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/data-stream' && req.method === 'GET') {
      const enc = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (eventName: string, data: unknown) => {
            try {
              controller.enqueue(enc.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`))
            } catch { /* client disconnected */ }
          }
          try {
            await buildApiResponseStream((stage, progress, detail) => {
              send('progress', { stage, progress, detail })
            })
            send('done', {})
          } catch (err) {
            send('error', safeError(err, { verbose: PROFILE === 'local' }).body)
          } finally {
            try { controller.close() } catch { /* already closed */ }
          }
        },
      })
      return new Response(stream, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      })
    }

    // ---- Notification history -------------------------------------------------------------
    // Persisted server-side (this machine's, or this central's — never mixed) so the bell shows
    // the SAME history on the desktop and on a phone, and only empties when the user says so.
    if (url.pathname === '/api/notifications') {
      try {
        // Who is asking. On a central every request carries a principal, and read/dismiss state is
        // per account; on a solo/member machine there are no accounts at all and `getPrincipal`
        // is always null — that instance has exactly one user, represented by `localViewer`.
        const principal = await getPrincipal(req)
        const viewer = principal
          ? { id: principal.accountId, canSeeNames: canSeeMemberNames(principal), multiTenant: true }
          : localViewer

        if (req.method === 'GET') {
          return json(await readStoredNotifications(viewer))
        }
        // POST creates a CLIENT-originated notification (the ones detected in the browser, e.g.
        // an available update or a failed central connection). Server-originated ones are already
        // persisted by broadcastNotification, so clients never re-post what arrives over SSE.
        if (req.method === 'POST') {
          const body = await req.json() as NotificationInput
          if (!body?.type || (!body.code && !body.title)) {
            return json({ error: 'type and either code or title are required' }, 400)
          }
          return json(await addStoredNotification({
            type: body.type, code: body.code, meta: body.meta, title: body.title, message: body.message,
          }, viewer))
        }
        // PATCH marks everything read (opening the bell). Kept separate from DELETE: reading a
        // notification and removing it are different intents.
        if (req.method === 'PATCH') {
          return json(await markStoredNotificationsRead(viewer))
        }
        // DELETE ?id=<id> removes one; DELETE with no id clears the history.
        if (req.method === 'DELETE') {
          const id = url.searchParams.get('id')
          return json(id ? await dismissStoredNotification(id, viewer) : await clearStoredNotifications(viewer))
        }
        return json({ error: 'method not allowed' }, 405)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return json({ error: message }, 500)
      }
    }

    if (url.pathname === '/api/preferences' && req.method === 'GET') {
      try {
        // Secrets never leave the process: the UI adds a connection by POSTing a token and every
        // other use (probe, leave, test) runs server-side, so nothing here needs one.
        const prefs = redactPreferences(await readPreferences())
        return new Response(JSON.stringify(prefs), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const safe = safeError(err, { verbose: PROFILE === 'local' })
        console.error(safe.logLine)
        return new Response(JSON.stringify(safe.body), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/preferences' && req.method === 'PUT') {
      try {
        let body = await req.json() as Preferences
        // C1: never let a PUT wipe `connections[]`. An old cached tab still PUTs a full flat solo
        // `team` object to disconnect (the current UI uses DELETE /api/team/connections/:id), and
        // that payload carries `connections: []` — which mergeTeamPayload honours as an explicit
        // replacement, deleting every OTHER central and its token in the process.
        if (body.team !== undefined) {
          const storedCount = (await readPreferences()).team?.connections?.length ?? 0
          const guard = guardTeamConnectionsWipe(body.team, storedCount)
          if (guard.guarded) {
            console.warn(
              `[preferences] PUT carried an empty connections array while ${storedCount} connection(s) are stored — ` +
              'preserving them. Use DELETE /api/team/connections/:id to disconnect one.',
            )
            body = { ...body, team: guard.team }
          }
        }
        await writePreferences(body)
        // On an archive-mode change, refresh the cache and immediately persist:
        // 'full' also mirrors raw files; any non-off mode warms a build that
        // writes the consolidated metrics store.
        if (body.archiveMode !== undefined) {
          invalidateCache()
          if (body.archiveMode === 'full') {
            fullSync().catch(err => console.warn('[archive] post-consent sync failed:', String(err)))
          }
          if (body.archiveMode !== 'off') {
            buildApiResponse().catch(err => console.warn('[archive] post-consent consolidation failed:', String(err)))
          }
        }
        // When the team config changes (e.g. connecting to a central from the web), don't wait
        // for the next poll/timer: open the reverse-channel WebSocket now so the member shows
        // up online on the central within ~a second, and kick an immediate push so its metrics
        // land right away instead of ~5 s later.
        if (body.team !== undefined) {
          reconcileNow()
          import('./team-uploader').then(m => m.pushNow()).catch(() => {})
        }
        // Redacted on the way out too — the response is the same document the GET returns.
        const updated = redactPreferences(await readPreferences())
        return new Response(JSON.stringify(updated), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        // R4: a lock timeout is transient contention, not a bad request — a 400/500 tells the
        // caller "this will never work", a 503+Retry-After tells it "try again shortly", which is
        // the true state of the world (another process is mid-write).
        if (err instanceof PreferencesLockTimeoutError) {
          return new Response(JSON.stringify({ error: 'another process is writing preferences — retry shortly' }), {
            status: 503,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Retry-After': '2' },
          })
        }
        const safe = safeError(err, { verbose: PROFILE === 'local' })
        console.error(safe.logLine)
        return new Response(JSON.stringify(safe.body), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/projects-list' && req.method === 'GET') {
      try {
        const dirs = await safeReadDir(PROJECTS_DIR)
        const entries: { name: string; path: string; encodedDir: string; sessionCount: number }[] = []
        await Promise.all(dirs.map(async dir => {
          const dirPath = `${PROJECTS_DIR}/${dir}`
          const files = await safeReadDir(dirPath)
          const jsonlFiles = files.filter(f => f.endsWith('.jsonl'))
          if (jsonlFiles.length === 0) return
          const fallbackPath = decodeProjectDir(dir)
          let projectPath = fallbackPath
          for (const f of jsonlFiles) {
            const cwd = await readCwdFromJsonl(`${dirPath}/${f}`)
            if (cwd) { projectPath = cwd; break }
          }
          const name = projectPath.split('/').filter(Boolean).pop() ?? dir
          entries.push({ name, path: projectPath, encodedDir: dir, sessionCount: jsonlFiles.length })
        }))
        // Collect project paths from all non-Claude harness adapters via their sessions.
        // Avoids touching statsCache (Claude-only) and reuses the already-loaded session data.
        const seenPaths = new Set(entries.map(e => e.path))
        const adapters = await getEnabledAdapters()
        await Promise.all(
          adapters
            .filter(a => a.id !== 'claude')
            .map(async a => {
              const sessions = await a.loadSessions()
              const byPath = new Map<string, number>()
              for (const s of sessions) {
                if (s.project_path) {
                  byPath.set(s.project_path, (byPath.get(s.project_path) ?? 0) + 1)
                }
              }
              for (const [projectPath, sessionCount] of byPath) {
                if (seenPaths.has(projectPath)) continue
                seenPaths.add(projectPath)
                const name = projectPath.split('/').filter(Boolean).pop() ?? projectPath
                entries.push({ name, path: projectPath, encodedDir: '', sessionCount })
              }
            })
        )

        entries.sort((a, b) => b.sessionCount - a.sessionCount)
        return new Response(JSON.stringify(entries), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const safe = safeError(err, { verbose: PROFILE === 'local' })
        console.error(safe.logLine)
        return new Response(JSON.stringify(safe.body), {
          status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/nay-sessions' && req.method === 'GET') {
      const sessions = await listNaySessions()
      return new Response(JSON.stringify(sessions), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/api/nay-sessions/') && req.method === 'GET') {
      const id = url.pathname.slice('/api/nay-sessions/'.length)
      const messages = await getNaySessionMessages(id)
      return new Response(JSON.stringify(messages), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // GET /api/claude-sessions?projectPath=...  → list sessions for a project
    // GET /api/claude-sessions/:id?projectPath=... → messages for a session
    if (url.pathname === '/api/claude-sessions' && req.method === 'GET') {
      const encodedDir = url.searchParams.get('encodedDir') ?? ''
      if (!encodedDir) {
        return new Response(JSON.stringify({ error: 'encodedDir required' }), {
          status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const sessions: ClaudeSessionSummary[] = await listClaudeSessions(encodedDir)
      return new Response(JSON.stringify(sessions), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/api/claude-sessions/') && req.method === 'GET') {
      const id = url.pathname.slice('/api/claude-sessions/'.length)
      const encodedDir = url.searchParams.get('encodedDir') ?? ''
      if (!encodedDir || !id) {
        return new Response(JSON.stringify({ error: 'encodedDir and id required' }), {
          status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const msgs: ClaudeSessionMessage[] = await getClaudeSessionMessages(encodedDir, id)
      return new Response(JSON.stringify(msgs), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // GET /api/codex-sessions → list all Codex sessions
    // GET /api/codex-sessions/:id → messages for a Codex session
    if (url.pathname === '/api/codex-sessions' && req.method === 'GET') {
      const sessions: CodexSessionSummary[] = await listCodexSessions()
      return new Response(JSON.stringify(sessions), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/api/codex-sessions/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/api/codex-sessions/'.length))
      if (!id) {
        return new Response(JSON.stringify({ error: 'id required' }), {
          status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const msgs: CodexSessionMessage[] = await getCodexSessionMessages(id)
      return new Response(JSON.stringify(msgs), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // GET /api/gemini-sessions → list all Gemini sessions
    // GET /api/gemini-sessions/:id → messages for a Gemini session
    if (url.pathname === '/api/gemini-sessions' && req.method === 'GET') {
      const sessions: GeminiSessionSummary[] = await listGeminiSessions()
      return new Response(JSON.stringify(sessions), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/api/gemini-sessions/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/api/gemini-sessions/'.length))
      if (!id) {
        return new Response(JSON.stringify({ error: 'id required' }), {
          status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const msgs: GeminiSessionMessage[] = await getGeminiSessionMessages(id)
      return new Response(JSON.stringify(msgs), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // GET /api/copilot-sessions → list all Copilot sessions
    // GET /api/copilot-sessions/:id → messages for a Copilot session
    if (url.pathname === '/api/copilot-sessions' && req.method === 'GET') {
      const sessions: CopilotSessionSummary[] = await listCopilotSessions()
      return new Response(JSON.stringify(sessions), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/api/copilot-sessions/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/api/copilot-sessions/'.length))
      if (!id) {
        return new Response(JSON.stringify({ error: 'id required' }), {
          status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const msgs: CopilotSessionMessage[] = await getCopilotSessionMessages(id)
      return new Response(JSON.stringify(msgs), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/api/mcp-list' && req.method === 'GET') {
      const projectPath = url.searchParams.get('projectPath') ?? null
      const result = await listMcpServers(projectPath)
      return new Response(JSON.stringify(result), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/api/mcp-action' && req.method === 'POST') {
      try {
        const body = await req.json() as { action: 'remove'; name: string }
        if (body.action === 'remove') {
          const result = await removeMcpServer(body.name)
          return new Response(JSON.stringify(result), {
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({ ok: false, error: 'unknown action' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, ...safeError(err, { verbose: PROFILE === 'local' }).body }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/chat-harnesses' && req.method === 'GET') {
      return new Response(JSON.stringify(chatHarnessStatus()), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/api/chat-tty' && req.method === 'POST') {
      try {
        const body = await req.json() as { message: string; history?: ChatMessage[]; model?: string; sessionId?: string | null; thinkingBudget?: number; attachments?: ChatAttachment[]; harness?: string }
        const { message, history = [], model: requestedModel, sessionId = null, thinkingBudget, attachments, harness } = body

        // Resolve the requested driver.
        // - If harness explicitly provided but not installed → stream an error (no silent Claude fallback)
        // - If harness not provided → default to claude
        // - Installed-but-not-authed harnesses still route to their driver
        const requestedDriver = harness ? getChatDriver(harness as import('@agentistics/core').HarnessId) : undefined
        if (harness && requestedDriver && !requestedDriver.isAvailable()) {
          const label = requestedDriver.label
          const errBody = new TextEncoder().encode(`data: ${JSON.stringify({ error: `${label} is not installed. Install it to use it as a Nay backend.` })}

`)
          return new Response(new ReadableStream({
            start(ctrl) { ctrl.enqueue(errBody); ctrl.close() },
          }), {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'X-Accel-Buffering': 'no',
            },
          })
        }
        const driver = (requestedDriver?.isAvailable() ? requestedDriver : undefined) ?? getChatDriver('claude')!

        // The model MUST belong to the resolved driver — a model from another
        // harness (or none) would be rejected by that CLI. Fall back to the
        // driver's defaultModel when the requested model isn't one of its own.
        const model = (requestedModel && driver.models.some(m => m.id === requestedModel))
          ? requestedModel
          : driver.defaultModel

        // Ensure MCP is registered for the selected driver
        await driver.ensureMcp(PORT)

        const enc = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            void driver.stream(
              message,
              history,
              model,
              {
                onChunk(text) {
                  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ text })}\n\n`))
                },
                onTool(tool) {
                  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ tool })}\n\n`))
                },
                onDone() {
                  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
                  ctrl.close()
                },
                onError(err) {
                  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ error: err })}\n\n`))
                  ctrl.close()
                },
                onSessionId(id) {
                  ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ sessionId: id })}\n\n`))
                },
              },
              sessionId,
              { thinkingBudget, attachments, signal: req.signal },
            )
          },
        })
        return new Response(stream, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
          },
        })
      } catch (err) {
        const safe = safeError(err, { verbose: PROFILE === 'local' })
        console.error(safe.logLine)
        return new Response(JSON.stringify(safe.body), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/claude-chat' && req.method === 'POST') {
      try {
        const body = await req.json() as { message: string; history?: ChatMessage[]; model?: ChatModelId; sessionId?: string | null; thinkingBudget?: number; projectPath?: string; attachments?: ChatAttachment[] }
        const { message, history = [], model = 'claude-sonnet-4-6', sessionId = null, thinkingBudget, projectPath, attachments } = body
        const enc = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            streamViaClaude(
              message,
              history,
              model,
              (text) => {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ text })}\n\n`))
              },
              (tool) => {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ tool })}\n\n`))
              },
              () => {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
                ctrl.close()
              },
              (err) => {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ error: err })}\n\n`))
                ctrl.close()
              },
              (id) => {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ sessionId: id })}\n\n`))
              },
              sessionId,
              { cwd: projectPath ?? CLAUDE_CHAT_DIR, thinkingBudget, attachments, signal: req.signal },
            )
          },
        })
        return new Response(stream, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
          },
        })
      } catch (err) {
        const safe = safeError(err, { verbose: PROFILE === 'local' })
        console.error(safe.logLine)
        return new Response(JSON.stringify(safe.body), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/exec' && req.method === 'POST') {
      try {
        const body = await req.json() as { command: string }
        if (!body.command?.trim()) {
          return new Response(JSON.stringify({ error: 'command required' }), {
            status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }
        const enc = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            execCommand(
              body.command.trim(),
              (text, isStderr) => {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ text, stderr: isStderr })}\n\n`))
              },
              (exitCode) => {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ exitCode, done: true })}\n\n`))
                ctrl.close()
              },
              (err) => {
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ error: err })}\n\n`))
                ctrl.close()
              },
            )
          },
        })
        return new Response(stream, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
          },
        })
      } catch (err) {
        const safe = safeError(err, { verbose: PROFILE === 'local' })
        console.error(safe.logLine)
        return new Response(JSON.stringify(safe.body), {
          status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/config' && req.method === 'GET') {
      try {
        const config = readEnvConfig()
        const backup = readEnvConfigBackup()
        const active: Record<string, string> = {}
        for (const field of CONFIG_FIELDS) {
          active[field.key] = process.env[field.key] ?? field.default
        }
        return new Response(JSON.stringify({ config, backup, active }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const safe = safeError(err, { verbose: PROFILE === 'local' })
        console.error(safe.logLine)
        return new Response(JSON.stringify(safe.body), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/config' && req.method === 'PUT') {
      try {
        const body = await req.json() as { values: Record<string, string> }
        writeEnvConfig(body.values)
        const config = readEnvConfig()
        return new Response(JSON.stringify({ ok: true, config }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const safe = safeError(err, { verbose: PROFILE === 'local' })
        console.error(safe.logLine)
        return new Response(JSON.stringify(safe.body), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/config/restore' && req.method === 'POST') {
      try {
        const ok = restoreEnvConfig()
        const config = readEnvConfig()
        return new Response(JSON.stringify({ ok, config }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const safe = safeError(err, { verbose: PROFILE === 'local' })
        console.error(safe.logLine)
        return new Response(JSON.stringify(safe.body), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    // Lightweight real-time poll: just the open-session ids, computed from live `claude`
    // processes against the cached build. Cheap enough to poll every few seconds so the
    // Sessions tab reflects opening/closing a session without a full data refetch.
    if (url.pathname === '/api/live-sessions' && req.method === 'GET') {
      try {
        const data = await buildApiResponse()
        const { getLiveSnapshot } = await import('./live-sessions')
        const snapshot = await getLiveSnapshot(data.sessions)
          .catch(() => ({ liveSessionIds: [] as string[], liveProcesses: [] as LiveProcess[] }))
        // Same member merge as /api/data — this is the endpoint the Sessions page polls, so
        // without it a central's "Open now" would only ever move on a full data rebuild.
        if (TEAM_CENTRAL) {
          try {
            const { collectMemberLive } = await import('./team-live')
            const { scopeAppDataToTeams, dataTeamIdsOf } = await import('./team-scope')
            const principal = await getPrincipal(req)
            let visibleUsers: Set<string> | null = null
            if (principal && principal.role !== 'owner') {
              const { listMachines } = await import('./team-tokens')
              const machines = await listMachines().catch(() => [])
              const owned = new Set(machines.filter(m => m.accountIds.includes(principal.accountId)).map(m => m.id))
              const scoped = scopeAppDataToTeams(data, dataTeamIdsOf(principal), owned)
              visibleUsers = new Set(scoped.sessions.map(s => s.user).filter((u): u is string => !!u))
            }
            const team = collectMemberLive(visibleUsers)
            snapshot.liveSessionIds = [...new Set([...snapshot.liveSessionIds, ...team.liveSessionIds])]
            snapshot.liveProcesses = [...snapshot.liveProcesses, ...team.liveProcesses]
          } catch { /* best-effort — the local snapshot still stands */ }
        }
        return new Response(JSON.stringify(snapshot), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch {
        return new Response(JSON.stringify({ liveSessionIds: [], liveProcesses: [] }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/data' && req.method === 'GET') {
      try {
        let data = await buildApiResponse()
        // Presence is live (in-memory sockets + heartbeat) — merge it in AFTER the cached
        // build so online/offline + latency stay fresh without recomputing the whole response.
        let extra: { presence?: unknown; includeOfflineData?: boolean } = {}
        if (TEAM_CENTRAL) {
          const [{ computePresence }, { getCentralConfig }] = await Promise.all([
            import('./team-presence'),
            import('./central-config'),
          ])
          const [presence, cfg] = await Promise.all([
            computePresence().catch(() => ({})),
            getCentralConfig().catch(() => null),
          ])
          extra = { presence, includeOfflineData: cfg?.includeOfflineData ?? true }
          // Apply per-team scoping for non-owner principals. A non-owner sees sessions from the
          // teams they MANAGE (see dataTeamIdsOf — belonging is not reading) PLUS any machine they
          // own — so a plain user keeps their own data, and their machines never disappear just
          // because they have no team.
          const principal = await getPrincipal(req)
          if (principal && principal.role !== 'owner') {
            const { scopeAppDataToTeams, dataTeamIdsOf } = await import('./team-scope')
            const { listMachines } = await import('./team-tokens')
            const machines = await listMachines().catch(() => [])
            const owned = new Set(machines.filter(m => m.accountIds.includes(principal.accountId)).map(m => m.id))
            data = scopeAppDataToTeams(data, dataTeamIdsOf(principal), owned)
          }
        }
        // Live open-session detection — computed per request (not part of the cached build)
        // so it reflects `claude` processes in real time.
        const { getLiveSnapshot } = await import('./live-sessions')
        let { liveSessionIds, liveProcesses } = await getLiveSnapshot(data.sessions)
          .catch(() => ({ liveSessionIds: [] as string[], liveProcesses: [] as LiveProcess[] }))
        // Central: members report their own open assistants over the reverse channel, because
        // getLiveSnapshot reads /proc and a member's processes are not on this machine. Scoped to
        // the members whose sessions survived the scoping above, so a principal never learns that
        // a machine they cannot see is running, nor reads its cwd off an unmatched process.
        if (TEAM_CENTRAL) {
          try {
            const { collectMemberLive } = await import('./team-live')
            const principal = await getPrincipal(req)
            const visibleUsers = principal && principal.role !== 'owner'
              ? new Set(data.sessions.map(s => s.user).filter((u): u is string => !!u))
              : null
            const team = collectMemberLive(visibleUsers)
            liveSessionIds = [...new Set([...liveSessionIds, ...team.liveSessionIds])]
            liveProcesses = [...liveProcesses, ...team.liveProcesses]
          } catch { /* best-effort — the local snapshot still stands */ }
        }
        return new Response(JSON.stringify({ ...data, liveSessionIds, liveProcesses, ...extra }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const safe = safeError(err, { verbose: PROFILE === 'local' })
        console.error('[/api/data]', safe.logLine)
        return new Response(JSON.stringify(safe.body), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    // ---------------------------------------------------------------------------
    // Auth routes (public — NOT behind the gate)
    // ---------------------------------------------------------------------------

    if (url.pathname === '/api/team/login' && req.method === 'POST') {
      return new Response(JSON.stringify({ ok: false, error: 'shared-password login retired; use account login' }), { status: 410, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
    }

    if (url.pathname === '/api/team/logout' && req.method === 'POST') {
      const res = handleLogout(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/team/session' && req.method === 'GET') {
      const res = handleSession(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/iam/login/mfa' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleIamLoginMfa } = await import('./iam-handlers')
      const res = await handleIamLoginMfa(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/iam/stepup' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleStepUp } = await import('./iam-handlers')
      const res = await handleStepUp(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/iam/recover' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleRecover } = await import('./iam-handlers')
      const res = await handleRecover(req, clientIp)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/iam/mfa' || url.pathname.startsWith('/api/iam/mfa/')) {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleMfa } = await import('./iam-handlers')
      const res = await handleMfa(req, url.pathname)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    // Owner-only (enforced by isAdminPath in the gate above): the security event log.
    if (url.pathname === '/api/iam/audit' && req.method === 'GET') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const limit = parseInt(url.searchParams.get('limit') ?? '200', 10)
      const events = await listAudit({ limit: Number.isFinite(limit) ? limit : 200 })
      return new Response(JSON.stringify({ events }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/api/iam/status' && req.method === 'GET') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleIamStatus } = await import('./iam-handlers')
      const res = await handleIamStatus()
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/iam/bootstrap' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleBootstrap } = await import('./iam-handlers')
      const res = await handleBootstrap(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/iam/login' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleIamLogin } = await import('./iam-handlers')
      // A successful login clears this IP's login bucket, so someone who mistyped twice
      // before getting it right is not left one attempt away from a block.
      const res = await handleIamLogin(req, {
        ip: clientIp,
        onSuccess: () => limiter.reset(`ip:${clientIp}:${url.pathname}`),
      })
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/iam/logout' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleLogout } = await import('./auth')
      const res = handleLogout(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/iam/me' && req.method === 'GET') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleIamMe } = await import('./iam-handlers')
      const res = await handleIamMe(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/iam/change-password' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleChangePassword } = await import('./iam-handlers')
      const res = await handleChangePassword(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/iam/accounts' && (req.method === 'GET' || req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE')) {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleAccounts } = await import('./iam-handlers')
      const res = await handleAccounts(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/iam/teams' && (req.method === 'GET' || req.method === 'POST' || req.method === 'DELETE')) {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleTeams } = await import('./iam-handlers')
      const res = await handleTeams(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/iam/machines' && (req.method === 'GET' || req.method === 'POST' || req.method === 'DELETE')) {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleMachines } = await import('./iam-handlers')
      const res = await handleMachines(req)
      // Revoke/rotate change the member set — refresh dashboards.
      if ((req.method === 'DELETE' || req.method === 'POST') && res.status >= 200 && res.status < 300) {
        const { triggerSseNotification } = await import('./sse'); triggerSseNotification()
      }
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    // GET /api/team/status — member-side connection status for the settings panel + status
    // pill, one entry per connection (see team-connections.ts). Reads cached values only — the
    // uploader's own push cycle measures latency, so this route never blocks on the network.
    if (url.pathname === '/api/team/status' && req.method === 'GET') {
      const { handleTeamStatus } = await import('./team-connections')
      const res = await handleTeamStatus(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    // Connection lifecycle — add/rotate, rename, delete, probe. See team-connections.ts for the
    // uniqueness rules (known endpoint updates in place; a token owned by another connection is
    // refused) and why DELETE calls the central's /api/team/leave before removing state.
    if (url.pathname === '/api/team/connections' && req.method === 'POST') {
      const { handleAddConnection } = await import('./team-connections')
      const res = await handleAddConnection(req)
      if (res.status === 200) { const { triggerSseNotification } = await import('./sse'); triggerSseNotification() }
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname.startsWith('/api/team/connections/') && req.method === 'PATCH') {
      const id = url.pathname.slice('/api/team/connections/'.length)
      const { handlePatchConnection } = await import('./team-connections')
      const res = await handlePatchConnection(req, id)
      if (res.status === 200) { const { triggerSseNotification } = await import('./sse'); triggerSseNotification() }
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname.startsWith('/api/team/connections/') && url.pathname.endsWith('/probe') && req.method === 'POST') {
      const id = url.pathname.slice('/api/team/connections/'.length, -'/probe'.length)
      const { handleProbeConnection } = await import('./team-connections')
      const res = await handleProbeConnection(req, id)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname.startsWith('/api/team/connections/') && req.method === 'DELETE') {
      const id = url.pathname.slice('/api/team/connections/'.length)
      const { handleDeleteConnection } = await import('./team-connections')
      const res = await handleDeleteConnection(req, id)
      if (res.status === 200) { const { triggerSseNotification } = await import('./sse'); triggerSseNotification() }
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    // ---------------------------------------------------------------------------
    // Admin routes (behind the gate — index.ts gate already enforces isAuthed)
    // ---------------------------------------------------------------------------

    if (url.pathname === '/api/team/members' && req.method === 'GET') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleMembers } = await import('./team-admin')
      const res = await handleMembers(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    // PUT /api/team/members — rename a member (update the token doc's user field).
    // Body: { id: string, user: string }  →  Response: { ok: boolean }
    // ADMIN-gated (already in ADMIN_PATHS). The new name is reflected at next read via
    // getMemberNameMap() without requiring any re-ingest of existing session docs.
    if (url.pathname === '/api/team/members' && req.method === 'PUT') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return new Response(JSON.stringify({ error: 'invalid JSON' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const b = body as Record<string, unknown>
      if (typeof b.id !== 'string' || !b.id || typeof b.user !== 'string' || !b.user.trim()) {
        return new Response(JSON.stringify({ error: 'id and user are required strings' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const { setMemberName } = await import('./team-tokens')
      const ok = await setMemberName(b.id, b.user.trim())
      if (ok) {
        // Rename re-labels all of the member's history (resolved at read time), so the
        // cached dashboard must be invalidated + connected dashboards notified to refresh.
        const { triggerSseNotification } = await import('./sse')
        triggerSseNotification()
      }
      return new Response(JSON.stringify({ ok }), {
        status: ok ? 200 : 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/api/team/tokens' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleMintToken } = await import('./team-admin')
      const res = await handleMintToken(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/team/tokens' && req.method === 'DELETE') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleRevokeToken } = await import('./team-admin')
      const res = await handleRevokeToken(req)
      // Revoke cascades to the member's sessions — refresh the dashboard immediately.
      if (res.status === 200) { const { triggerSseNotification } = await import('./sse'); triggerSseNotification() }
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/team/tokens/rotate' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleRotateToken } = await import('./team-admin')
      const res = await handleRotateToken(req)
      // Rotation migrates the member's history to the new identity key — refresh the dashboard.
      if (res.status === 200) { const { triggerSseNotification } = await import('./sse'); triggerSseNotification() }
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    // Repositories — GitHub Actions registration (admin-gated on the central).
    if (url.pathname === '/api/team/repos' && req.method === 'GET') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleListRepos } = await import('./team-admin')
      const res = await handleListRepos(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/team/repos' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleRegisterRepo } = await import('./team-admin')
      const res = await handleRegisterRepo(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/team/repos' && req.method === 'DELETE') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleUnregisterRepo } = await import('./team-admin')
      const res = await handleUnregisterRepo(req)
      if (res.status === 200) { const { triggerSseNotification } = await import('./sse'); triggerSseNotification() }
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    // Tags (B5) — saved groupings of repos/projects/machines/teams/accounts. The handler owns the
    // authority rules: writes require every source to be visible to the caller, and every response
    // is aggregate-only (never the sessions behind a tag).
    //
    // Served in EVERY mode, not just on a central. On a solo/member machine the handler swaps the
    // Mongo store for ~/.agentistics/tags.json and the team session set for the local one; the
    // central's cookie gate above is untouched. This used to 404 with a plain-TEXT body, which the
    // frontend then fed to JSON.parse — the Tags page died on a SyntaxError instead of working.
    if ((url.pathname === '/api/tags' || url.pathname.startsWith('/api/tags/'))
        && ['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
      const { handleTags } = await import('./tags-handlers')
      const res = await handleTags(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/team/test-connection' && req.method === 'POST') {
      const { handleTeamTestConnection } = await import('./team-uploader')
      const res = await handleTeamTestConnection(req)
      // Re-wrap to attach CORS headers (handler sets only Content-Type)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/team/push-now' && req.method === 'POST') {
      const { handlePushNow } = await import('./team-uploader')
      const res = await handlePushNow(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    if (url.pathname === '/api/team/ingest' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleTeamIngest } = await import('./team-ingest')
      const res = await handleTeamIngest(req)
      // Re-wrap to attach CORS headers (handler sets only Content-Type)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    // POST /api/team/leave — central: a member removes ITS OWN data (token-gated).
    if (url.pathname === '/api/team/leave' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleTeamLeave } = await import('./team-ingest')
      const res = await handleTeamLeave(req)
      if (res.status === 200) { const { triggerSseNotification } = await import('./sse'); triggerSseNotification() }
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    // POST /api/team/forget — a member deletes NAMED sessions of its own (repository sharing
    // rules, §7). Minted-token-only, inside the handler; see team-forget.ts for why there is no
    // legacy branch. Central-only, like every other team ingest route.
    if (url.pathname === '/api/team/forget' && req.method === 'POST') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { handleTeamForget } = await import('./team-forget')
      const res = await handleTeamForget(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    // POST /api/team/leave-central — member proxy: tells the central to drop this member's
    // data, then the web resets the local config to solo. Keeps the token server-side.
    if (url.pathname === '/api/team/leave-central' && req.method === 'POST') {
      const { handleLeaveCentral } = await import('./team-uploader')
      const res = await handleLeaveCentral(req)
      const headers = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
      return new Response(res.body, { status: res.status, headers })
    }

    // ---------------------------------------------------------------------------
    // GET /api/team/deploy — generate a ready-to-use .env + docker compose command.
    // Only available in central mode. Protected by auth gate when a password is set.
    // Generates fresh random password + session secret on each call (shown once).
    // ---------------------------------------------------------------------------
    if (url.pathname === '/api/team/deploy' && req.method === 'GET') {
      if (!TEAM_CENTRAL) {
        return new Response(JSON.stringify({ error: 'central mode only' }), {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      try {
        const { randomBytes } = await import('node:crypto')
        const { generateEnvFile } = await import('./deploy')

        const sessionSecret = randomBytes(32).toString('hex')
        const mongoUrl = 'mongodb://mongo:27017/?replicaSet=rs0'

        const env = generateEnvFile({
          sessionSecret,
          mongoUrl,
          mongoDb: 'agentistics',
          // Read org and port from query params; the client-side counterpart is
          // AUTOSTART_SNIPPETS in packages/web/src/components/DeployCentral.tsx
          teamOrg: url.searchParams.get('org') || 'default',
          appPort: parseInt(url.searchParams.get('port') || '47291', 10),
        })

        return new Response(JSON.stringify({
          env,
          command: 'docker compose --env-file central.env up -d',
          sessionSecret,
        }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      } catch (err) {
        const safe = safeError(err, { verbose: PROFILE === 'local' })
        console.error(safe.logLine)
        return new Response(JSON.stringify(safe.body), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    // ---------------------------------------------------------------------------
    // GET /api/team/policy — PUBLIC: returns the central push interval.
    // Members poll this before each push cycle to get the current cadence.
    // Non-central instances return the default so members degrade gracefully.
    // ---------------------------------------------------------------------------
    if (url.pathname === '/api/team/policy' && req.method === 'GET') {
      const { getCentralConfig, getInstanceId } = await import('./central-config')
      const { CENTRAL_CAPABILITIES } = await import('./team-capabilities')
      const [config, instanceId] = await Promise.all([getCentralConfig(), getInstanceId()])
      return new Response(JSON.stringify({
        pushIntervalSec: config.pushIntervalSec,
        instanceId,
        capabilities: CENTRAL_CAPABILITIES,
      }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // ---------------------------------------------------------------------------
    // GET /api/team/config — ADMIN (TEAM_CENTRAL + hasValidSession): read config.
    // PUT /api/team/config — ADMIN: update pushIntervalSec.
    // ---------------------------------------------------------------------------
    if (url.pathname === '/api/team/config' && req.method === 'GET') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      const { getCentralConfig } = await import('./central-config')
      const config = await getCentralConfig()
      return new Response(JSON.stringify(config), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/api/team/config' && req.method === 'PUT') {
      if (!TEAM_CENTRAL) return new Response('Not found', { status: 404, headers: CORS_HEADERS })
      let body: { pushIntervalSec?: unknown; includeOfflineData?: unknown; publicUrl?: unknown; requireDeleteConfirmText?: unknown; includeDeletedMembers?: unknown }
      try {
        body = await req.json() as { pushIntervalSec?: unknown; includeOfflineData?: unknown; publicUrl?: unknown; requireDeleteConfirmText?: unknown; includeDeletedMembers?: unknown }
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      if (body.publicUrl !== undefined && typeof body.publicUrl !== 'string') {
        return new Response(JSON.stringify({ error: 'publicUrl must be a string' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      if (body.pushIntervalSec !== undefined && typeof body.pushIntervalSec !== 'number') {
        return new Response(JSON.stringify({ error: 'pushIntervalSec must be a number' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      if (body.includeOfflineData !== undefined && typeof body.includeOfflineData !== 'boolean') {
        return new Response(JSON.stringify({ error: 'includeOfflineData must be a boolean' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      // Turning the typed-delete guard OFF weakens a safety net for everyone on this central, so
      // it is owner-only — unlike the other fields, which any admin session may set.
      // Same owner-only rule: this changes what EVERY viewer of this central sees.
      if (body.includeDeletedMembers !== undefined) {
        if (typeof body.includeDeletedMembers !== 'boolean') {
          return new Response(JSON.stringify({ error: 'includeDeletedMembers must be a boolean' }), {
            status: 400,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }
        const { getPrincipal } = await import('./auth')
        const { can } = await import('./iam-caps')
        const principal = await getPrincipal(req)
        if (!principal || !can(principal, 'central:config')) {
          return new Response(JSON.stringify({ error: 'forbidden' }), {
            status: 403,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }
      }
      if (body.requireDeleteConfirmText !== undefined) {
        if (typeof body.requireDeleteConfirmText !== 'boolean') {
          return new Response(JSON.stringify({ error: 'requireDeleteConfirmText must be a boolean' }), {
            status: 400,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }
        const { getPrincipal } = await import('./auth')
        const { can } = await import('./iam-caps')
        const principal = await getPrincipal(req)
        if (!principal || !can(principal, 'central:config')) {
          return new Response(JSON.stringify({ error: 'forbidden' }), {
            status: 403,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        }
      }
      const { setPushInterval, setIncludeOfflineData, setPublicUrl, setRequireDeleteConfirmText, setIncludeDeletedMembers, getCentralConfig } = await import('./central-config')
      if (typeof body.pushIntervalSec === 'number') await setPushInterval(body.pushIntervalSec)
      if (typeof body.includeOfflineData === 'boolean') await setIncludeOfflineData(body.includeOfflineData)
      if (typeof body.publicUrl === 'string') await setPublicUrl(body.publicUrl)
      if (typeof body.requireDeleteConfirmText === 'boolean') await setRequireDeleteConfirmText(body.requireDeleteConfirmText)
      if (typeof body.includeDeletedMembers === 'boolean') await setIncludeDeletedMembers(body.includeDeletedMembers)
      const config = await getCentralConfig()
      // A policy change (offline-data default) affects every viewer → nudge them to refetch.
      // Both policies change what everyone sees → nudge open dashboards to refetch.
      if (typeof body.includeOfflineData === 'boolean' || typeof body.includeDeletedMembers === 'boolean') triggerSseNotification()
      return new Response(JSON.stringify(config), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // ---------------------------------------------------------------------------
    // WebSocket upgrade — member ↔ central reverse channel (Phase 7)
    // POST/GET /api/team/agent — upgrade to WebSocket for connected members.
    // Auth: validateIngestToken (Bearer in Authorization header), NOT session cookie.
    // This path is in AUTH_PUBLIC so the cookie gate above does not block it.
    // ---------------------------------------------------------------------------
    if (url.pathname === '/api/team/agent') {
      if (!TEAM_CENTRAL) {
        return new Response(JSON.stringify({ error: 'not found' }), {
          status: 404,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      const authHeader = req.headers.get('authorization') ?? ''
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
      const tokenResult = await validateIngestToken(bearer)
      if (!tokenResult.ok || !tokenResult.user) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      // memberId (the token hash) identifies the MACHINE, and travels so the live-session registry
      // can key snapshots per machine — a person with two machines sends two independent snapshots.
      const upgraded = server.upgrade(req, {
        data: { user: tokenResult.user, memberId: tokenResult.memberId, isAgent: true as const },
      })
      if (upgraded) return // WebSocket handshake handed off to the websocket: {} handler
      return new Response(JSON.stringify({ error: 'upgrade failed' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // ---------------------------------------------------------------------------
    // GET /api/team/session-chat — REMOVED. Central no longer views member chat;
    // always returns 410 Gone regardless of TEAM_CENTRAL.
    // ---------------------------------------------------------------------------
    if (url.pathname === '/api/team/session-chat' && req.method === 'GET') {
      return new Response(JSON.stringify({ ok: false, error: 'chat_disabled' }), {
        status: 410,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }


    // ---------------------------------------------------------------------------
    // GET /api/team/whoami — PUBLIC (token-gated): resolves identity from bearer.
    // Members call this after a test-connection to learn their user + org.
    // The token is validated server-side; the plaintext is never logged.
    // ---------------------------------------------------------------------------
    if (url.pathname === '/api/team/whoami' && req.method === 'GET') {
      const authHeader = req.headers.get('authorization') ?? ''
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
      const tokenResult = await validateIngestToken(bearer)
      if (tokenResult.ok) {
        // For machine tokens (bound to an account), also surface the machine's
        // bound identity: machineName (token label), teamId, team name, and the owner's email.
        // Only non-secret account fields are exposed — never passwordHash.
        const body: { ok: true; user: string; org: string; machineName?: string; teamId?: string; email?: string; team?: string } = {
          ok: true,
          user: tokenResult.user,
          org: TEAM_ORG,
        }
        // machineName (token label) + teamId are available for EVERY machine token, not just
        // account-bound ones — so a machine always shows its own name + owner user, even legacy
        // (no-account) tokens. email requires the linked account.
        if (tokenResult.label) body.machineName = tokenResult.label
        if (tokenResult.teamId) {
          body.teamId = tokenResult.teamId
          const t = await getTeam(tokenResult.teamId)
          if (t) body.team = t.name
        }
        if (tokenResult.accountId) {
          const account = await getAccount(tokenResult.accountId)
          if (account?.email) body.email = account.email
        }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ ok: false }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Serve embedded frontend assets (binary mode only)
    if (!url.pathname.startsWith('/api')) {
      const asset = serveStatic(url.pathname)
      if (asset) return asset
      // SPA fallback — any unknown path gets index.html
      const fallback = serveStatic('/index.html')
      if (fallback) return fallback
    }

    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
}

try {
// PORT (47291) is always the api + mcp endpoint.
Bun.serve<WSData>({ port: PORT, idleTimeout: 60, maxRequestBodySize: LIMITS.ingestBodyBytes, websocket: _wsHandlers, fetch: handleRequest })
// Binary mode also serves the web dashboard on WEB_PORT (47292) — that's the URL you open.
// Same handler → the SPA's same-origin `/api/*` calls resolve against 47292 and just work,
// while 47291 stays the dedicated api + mcp port.
if (SERVE_STATIC) {
  Bun.serve<WSData>({ port: WEB_PORT, idleTimeout: 60, maxRequestBodySize: LIMITS.ingestBodyBytes, websocket: _wsHandlers, fetch: handleRequest })
}

const _ESC = '\x1b'
const _R   = `${_ESC}[0m`
const _B   = `${_ESC}[1m`
const _D   = `${_ESC}[2m`
const _AM  = `${_ESC}[38;5;208m`
const _EM  = `${_ESC}[92m`
const _CY  = `${_ESC}[96m`
const _WH  = `${_ESC}[97m`

const _SEP = `${_D}${''.repeat(44)}${_R}`
const _DOT = `${_EM}●${_R}`
const _URL = (u: string) => `${_CY}${_B}${u}${_R}`

const _UI_PORT = process.env.VITE_PORT ?? '47292'
// Binary mode: the web dashboard has its own port (WEB_PORT, 47292). Dev: Vite's port.
const _WEB_URL = SERVE_STATIC ? `http://localhost:${WEB_PORT}` : `http://localhost:${_UI_PORT}`

process.stdout.write(
  `\n${_SEP}\n` +
  `  ${_B}${_AM}agentistics${_R}\n` +
  `${_SEP}\n` +
  `  ${_WH}web${_R}  ${_DOT}  ${_URL(_WEB_URL)}\n` +
  `  ${_WH}api${_R}  ${_DOT}  ${_URL(`http://localhost:${PORT}`)}\n` +
  `  ${_WH}mcp${_R}  ${_DOT}  ${_D}agentistics (stdio → http://localhost:${PORT})${_R}\n` +
  `${_SEP}\n\n`
)
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('EADDRINUSE') || msg.includes('already in use')) {
    console.log(`[server] Port ${PORT} already in use — reusing existing instance.`)
    process.exit(0)
  }
  throw err
}
