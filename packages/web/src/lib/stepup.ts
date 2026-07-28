/**
 * stepup.ts — client side of the "sudo mode" grant (see server/stepup.ts).
 *
 * Destructive operations answer `403 { error: 'stepup_required' }` until the caller presents a
 * fresh grant in `X-Stepup`. Rather than making every call site know that, `stepUpFetch` wraps
 * `fetch`: it attaches a cached grant when it has one, and on a `stepup_required` refusal it
 * asks the user to re-authenticate, mints a grant, and retries the request once.
 *
 * The grant lives in memory only — never localStorage. It is a credential with a five-minute
 * life; persisting it across reloads would hand a second, quieter session to anything that can
 * read storage.
 */

let token: string | null = null
let expiresAt = 0

/** Set by App.tsx: opens the re-auth dialog and resolves with what the user typed, or null. */
type Prompter = () => Promise<{ password?: string; code?: string } | null>
let prompter: Prompter | null = null

export function setStepUpPrompter(fn: Prompter | null): void {
  prompter = fn
}

export function clearStepUp(): void {
  token = null
  expiresAt = 0
}

function cached(): string | null {
  // A small safety margin: a grant about to expire in flight is worse than asking again.
  return token && Date.now() < expiresAt - 5_000 ? token : null
}

async function mintGrant(): Promise<string | null> {
  if (!prompter) return null
  const answer = await prompter()
  if (!answer) return null
  const res = await fetch('/api/iam/stepup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(answer),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { ok?: boolean; token?: string; expiresInSec?: number }
  if (!data.ok || !data.token) return null
  token = data.token
  expiresAt = Date.now() + (data.expiresInSec ?? 300) * 1000
  return token
}

function withHeader(init: RequestInit | undefined, grant: string): RequestInit {
  const headers = new Headers(init?.headers)
  headers.set('X-Stepup', grant)
  return { ...init, headers }
}

/**
 * Drop-in replacement for `fetch` on routes that may demand re-authentication.
 * Retries exactly once — a second refusal is a real failure and is returned to the caller.
 */
export async function stepUpFetch(input: string, init?: RequestInit): Promise<Response> {
  const grant = cached()
  const first = await fetch(input, grant ? withHeader(init, grant) : init)
  if (first.status !== 403) return first

  // Only a stepup refusal is retryable; a plain authorization failure must surface as-is.
  let body: { error?: string } = {}
  try {
    body = (await first.clone().json()) as { error?: string }
  } catch {
    return first
  }
  if (body.error !== 'stepup_required') return first

  clearStepUp()
  const fresh = await mintGrant()
  if (!fresh) return first
  return fetch(input, withHeader(init, fresh))
}
