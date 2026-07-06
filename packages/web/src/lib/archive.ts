import type { ArchiveMode } from '../components/ArchiveConsentModal'

export type { ArchiveMode }

/**
 * Resolve the first-run archive choice from a SUCCESSFULLY loaded preferences object.
 *
 *   - an explicit `archiveMode` wins,
 *   - else migrate the legacy `archiveSessions` boolean (true→'full', false→'off'),
 *   - else `null` — meaning "genuinely not chosen yet" (the consent gate shows).
 *
 * IMPORTANT: only call this with a real 200 response body. A `null` return is the
 * "show the gate" sentinel — a FAILED load (network/5xx) must NOT be funneled through
 * here, or a transient hiccup would re-prompt a user who already chose. The caller keeps
 * its state at `undefined` (neutral loading) and retries on failure instead.
 */
export function resolveArchiveChoice(
  prefs: { archiveMode?: ArchiveMode; archiveSessions?: boolean },
): ArchiveMode | null {
  const mode: ArchiveMode | undefined =
    prefs.archiveMode ??
    (prefs.archiveSessions === true ? 'full' : prefs.archiveSessions === false ? 'off' : undefined)
  return mode ?? null
}
