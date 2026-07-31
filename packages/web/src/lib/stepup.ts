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

export interface StepUpAsk {
  /** True when this account has a second factor enrolled — the server will take NOTHING else. */
  needsCode: boolean
  /** True when the previous answer was refused, so the dialog can say so instead of reopening blank. */
  retry: boolean
}

/** Set by StepUpPrompt: opens the re-auth dialog and resolves with what the user typed, or null. */
type Prompter = (ask: StepUpAsk) => Promise<{ password?: string; code?: string } | null>
let prompter: Prompter | null = null

/** How many refusals to sit through before giving up; the server rate-limits this endpoint too. */
const MAX_ATTEMPTS = 3

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

/**
 * Which factor the server will demand of THIS account. Asked before the dialog opens, because a
 * dialog that asks an enrolled user for their password can only ever be refused — which is how
 * this feature read as "click confirm, nothing happens" for exactly the people it exists for.
 * An unreachable probe falls back to the password: the server is still the one deciding, and a
 * refusal below corrects the mode for the next attempt.
 */
async function factorNeeded(): Promise<boolean> {
  try {
    const res = await fetch('/api/iam/mfa')
    if (!res.ok) return false
    const data = (await res.json()) as { enabled?: boolean }
    return data.enabled === true
  } catch {
    return false
  }
}

async function mintGrant(): Promise<string | null> {
  if (!prompter) return null
  let needsCode = await factorNeeded()
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const answer = await prompter({ needsCode, retry: attempt > 0 })
    if (!answer) return null // cancelled — the caller gets the original refusal, not a hang
    const res = await fetch('/api/iam/stepup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(answer),
    })
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean; token?: string; expiresInSec?: number }
      if (!data.ok || !data.token) return null
      token = data.token
      expiresAt = Date.now() + (data.expiresInSec ?? 300) * 1000
      return token
    }
    // 401 is a wrong credential: worth another try, with the factor the server named. Anything
    // else (429, 500) is not the user's to fix by retyping, so stop rather than hammer.
    if (res.status !== 401) return null
    const body = (await res.json().catch(() => ({}))) as { mfaRequired?: boolean }
    if (typeof body.mfaRequired === 'boolean') needsCode = body.mfaRequired
  }
  return null
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
