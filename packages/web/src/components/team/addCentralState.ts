import type { TeamConnection, ShareSource } from '@agentistics/core'
import { NO_REPO_KEY, normalizeEndpointKey, unpackConnectToken } from '@agentistics/core'
import type { ShareTarget } from '../../lib/shareRepos'
import { shareAllDraft } from './repoPanelState'
import { buildSourcesFromDraft, type ShareMode, type SubmittedRules } from './sharePanelState'

/**
 * addCentralState.ts — the pure decisions behind `AddCentralDrawer.tsx` (Task 12, design doc §9.6).
 *
 * Same seam as `cardState.ts` (Task 10) and `repoPanelState.ts` (Task 11): every decision that is
 * substantive rather than presentational lives here, unit-tested directly, so the component reads
 * as layout plus fetches over these functions. Nothing here touches the network or React.
 *
 * The one rule this whole file exists to protect: the rules chosen in step 2 must be committed in
 * the SAME `POST /api/team/connections` that creates the connection — never a create followed by
 * a PATCH. That is why `buildSubmitBody` produces the entire request body, denylist included, and
 * why nothing here ever returns a partial body meant to be finished with a second write.
 */

// --- the step machine -----------------------------------------------------------------------

export type WizardStep = 'identity' | 'rules'

/** The outcome of the ONE test the wizard trusts: `POST /api/team/test-connection`. `null` means
 *  "never tested since the endpoint/token last changed" — deliberately distinct from `{ ok: false
 *  }`, so editing either field after a successful test can reset this to `null` and re-lock step
 *  2 without inventing a fake error message. */
export type TestOutcome =
  | null
  | { ok: true; user: string; org?: string }
  | { ok: false; error: string }

/**
 * Step 2 opens ONLY after a successful test AND only when the token is not already claimed by a
 * different connection — choosing what a central may see is meaningless before you know which
 * central answered, and a token-in-use pairing is refused outright (see `resolveDupeState`) so
 * there is no "which rules" to choose for it at all.
 */
export function canOpenRules(test: TestOutcome, dupe: DupeState): boolean {
  return test !== null && test.ok && dupe.kind !== 'tokenInUse'
}

/** Connect is reachable only from step 2, and only under the same gate that unlocked it — a
 *  direct call can never fire from step 1, regardless of what `test`/`dupe` claim. */
export function canConnect(step: WizardStep, test: TestOutcome, dupe: DupeState): boolean {
  return step === 'rules' && canOpenRules(test, dupe)
}

/**
 * Whether the identity step's SINGLE primary action may even attempt the
 * `POST /api/team/test-connection` call — used by both the merged "Save" button (test, then on
 * success advance to step 2) and the optional standalone "Test connection" affordance, so neither
 * can fire a request in a case the other refuses. A token already claimed by a DIFFERENT
 * connection must produce NO request at all (the product requirement this whole file exists to
 * protect, per `resolveDupeState`'s doc comment) — `tokenInUse` is refused outright, never
 * "tested and then blocked from continuing". An empty endpoint has nothing to test. A plain
 * `duplicate` (the documented token-rotation path) is allowed through: testing the replacement
 * token before rotating it in is exactly the point.
 */
export function canAttemptTest(endpoint: string, dupe: DupeState): boolean {
  return endpoint.trim().length > 0 && dupe.kind !== 'tokenInUse'
}

// --- token unpacking --------------------------------------------------------------------------

export interface UnpackedToken {
  /** '' when the pasted token carries no embedded endpoint (a plain token, or one that failed to
   *  decode) — never `undefined`, so it composes directly with a controlled `<input value>`. */
  endpoint: string
  /** The bare secret to send as the bearer — never the composite `act1_...` form. */
  token: string
}

/**
 * Wraps `@agentistics/core`'s `unpackConnectToken` for this wizard's field shapes. That function
 * already never throws — a value that starts with `act1_` but fails to base64-decode falls back
 * to treating the WHOLE input as the raw secret (see its own doc comment) — so this wrapper only
 * has to normalize `endpoint: undefined` to `''`, never add its own error handling.
 */
export function unpackToken(raw: string): UnpackedToken {
  const { endpoint, secret } = unpackConnectToken(raw)
  return { endpoint: endpoint ?? '', token: secret }
}

// --- duplicate-endpoint / token-in-use decisions -----------------------------------------------

export type DupeState =
  | { kind: 'none' }
  /** The endpoint already exists among `connections` — the documented token-rotation path. */
  | { kind: 'duplicate'; existing: TeamConnection }
  /** The token belongs to a DIFFERENT connection. No request may be sent for this pairing. */
  | { kind: 'tokenInUse'; existing: TeamConnection }

/**
 * Mirrors the server's `decideConnectionUpsert` (`team-connections.ts`) so the wizard can react to
 * the SAME two rules before it ever sends a request — the `tokenInUse` case must send NO request
 * at all (per the task brief), so the check has to happen here, client-side, not merely be
 * discovered from a server error after the fact. Endpoint identity goes through the shared
 * `normalizeEndpointKey` (case-folds the host, folds the scheme's default port, trims a trailing
 * slash) — the exact rule the server uses, so the two can never disagree about what counts as
 * "the same central". An empty endpoint (nothing typed yet) never resolves to a dupe.
 */
export function resolveDupeState(
  connections: readonly TeamConnection[],
  endpoint: string,
  token: string,
): DupeState {
  const trimmedEndpoint = endpoint.trim()
  if (!trimmedEndpoint) return { kind: 'none' }
  const norm = normalizeEndpointKey(trimmedEndpoint)
  const byEndpoint = connections.find(c => normalizeEndpointKey(c.endpoint) === norm)
  const byToken = token ? connections.find(c => c.token === token) : undefined
  if (byToken && (!byEndpoint || byToken.id !== byEndpoint.id)) {
    return { kind: 'tokenInUse', existing: byToken }
  }
  if (byEndpoint) return { kind: 'duplicate', existing: byEndpoint }
  return { kind: 'none' }
}

// --- step 2 default draft ----------------------------------------------------------------------

/** Step 2 defaults to share-everything — `shareAllDraft` (Task 11) already forces every LOCKED
 *  (`conflictPaths`) key in regardless, so a locked row can never be shared from this wizard
 *  either, the same guarantee `repoPanelState.ts` gives the edit view. Re-exported under this
 *  file's own name rather than importing `shareAllDraft` at every call site, so a future rename in
 *  `repoPanelState.ts` has exactly one place to update here. */
export function buildDefaultDraft(targets: readonly ShareTarget[]): Set<string> {
  return shareAllDraft(targets)
}

// --- dirty ---------------------------------------------------------------------------------

/** True the instant the user has typed anything or touched a step-2 rule — what the `Drawer`'s
 *  discard-confirmation gate (`dirty`) reads. A pristine drawer (nothing typed, no rule touched)
 *  is never dirty, so opening and immediately closing it never asks to confirm. */
export function computeDirty(token: string, endpoint: string, rulesTouched: boolean): boolean {
  return token.trim().length > 0 || endpoint.trim().length > 0 || rulesTouched
}

// --- the submit body -------------------------------------------------------------------------

export interface ConnectSubmitBody {
  endpoint: string
  token: string
  org: string
  shareMode: ShareMode
  sources: ShareSource[]
}

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * The zero→non-zero transition rule (mirrors the server's `withUnresolvedSources` in
 * `share-rules.ts`), DENYLIST MODE ONLY: an EMPTY repo-key draft stays `[]` ("share everything"),
 * but the moment anything at all is blocked, `NO_REPO_KEY` widens in automatically — a user who
 * blocks one repository without ever touching the "no repository" bucket should not have
 * unattributed sessions leak through by omission. In ALLOWLIST mode there is nothing to widen —
 * the unattributed bucket is already hidden by default like everything not explicitly listed, so
 * widening it in would be the ONE thing that silently shares more than the user chose. Duplicated
 * here rather than imported (the web bundle cannot import `packages/server/*`) — the exact same
 * reasoning `repoPanelState.ts`'s `normalizeDenied` already documents for its own server mirror.
 */
function withNoRepoWidening(mode: ShareMode, keys: readonly string[]): string[] {
  if (mode === 'allowlist' || keys.length === 0) return [...keys]
  return keys.includes(NO_REPO_KEY) ? [...keys] : [...keys, NO_REPO_KEY]
}

/**
 * The ONE request body this wizard ever produces — `{ endpoint, token, org, shareMode, sources }`
 * for the single `POST /api/team/connections` that creates the connection AND commits the rules
 * together. `sources` is built from `submitted` (repo keys widened by `withNoRepoWidening` in
 * denylist mode) via `buildSourcesFromDraft`.
 *
 * No `label` — the wizard never collects one. The MACHINE's name is set by the central on the
 * minted token (`TeamConnection.label`'s own doc comment); a machine choosing its own name here
 * would be exactly the invariant the product forbids. A `label` that does exist (an older config,
 * or the CLI's `--label`) names the CENTRAL, never the machine: `ConnectionCard` titles the card
 * with it and resolves the machine name from the probed `machineName`, falling back to the
 * endpoint host and never to the label (`cardIdentity.ts`).
 *
 * `submitted` is a `SubmittedRules`, i.e. the output of `resolveSubmittedRules` — NEVER the
 * wizard's two raw drafts. That distinction is the whole of a Critical review finding: the drafts
 * mean "this switch is OFF" in both modes, while an allowlist's `sources` mean the OPPOSITE, so
 * passing them straight through sent the central the one repository the user had just hidden and
 * nothing else. Taking the converted struct (not two loose Sets) is what makes the correct call
 * the obvious one at the call site.
 */
export function buildSubmitBody(input: {
  endpoint: string
  token: string
  org: string
  mode: ShareMode
  submitted: SubmittedRules
}): ConnectSubmitBody {
  const endpoint = trimTrailingSlashes(input.endpoint.trim())
  const org = input.org.trim()
  const widenedRepoKeys = withNoRepoWidening(input.mode, [...input.submitted.repoKeys])
  return {
    endpoint,
    token: input.token,
    org,
    shareMode: input.mode,
    sources: buildSourcesFromDraft(new Set(widenedRepoKeys), input.submitted.projectPaths),
  }
}
