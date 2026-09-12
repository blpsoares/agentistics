/**
 * studioGateHold.ts — whether `editorEnabled` dropping out from under an OPEN Studio is a moment
 * `ArtifactsAside` must intercept, and what it mounts/shows while that moment is being HELD.
 *
 * `editorEnabled` used to be frozen at boot, so a switch turned off in another tab (Settings) could
 * never reach a Studio already open here — the path this file's rules cover was UNREACHABLE. Now
 * that the flag is live (`App.tsx`'s `refreshTeamSession`), a `true -> not true` edge is a genuine
 * close attempt, and the Studio holds Monaco buffers that exist in exactly one place in the world —
 * so it has to go through the same question `artifactsStore.ts`'s `closeArtifacts` already asks
 * (`unsavedBuffers.ts`'s `holdIfUnsaved`) rather than unmounting underneath a reader mid-keystroke.
 *
 * `studioGateJustClosed` names the ONE edge that qualifies — a steady `false` (nothing changed since
 * the last render) or the RISING edge turning the switch back on must never re-ask, or every
 * unrelated re-render while the switch happens to already be off would raise the question again.
 *
 * `studioGateMounted` / `studioGateShown` are `ArtifactsAside`'s own `studioMounted` / `inStudio`,
 * widened by exactly one term: `gateHeld` reads as "the gate is still open" for exactly as long as a
 * drop it started is unanswered (or answered "keep") — the same way `studio || studioOpened` already
 * reads as "still mounted" once the reader has been here, regardless of which tab is on screen.
 */

/** Is THIS transition the edge that must attempt a close? */
export function studioGateJustClosed(
  wasEnabled: boolean | undefined,
  isEnabled: boolean | undefined,
  studioInUse: boolean,
): boolean {
  return wasEnabled === true && isEnabled !== true && studioInUse
}

/** Mounted: the gate is open (or a close attempt on it is being held) AND the reader has been here. */
export function studioGateMounted(
  editorEnabled: boolean | undefined,
  gateHeld: boolean,
  studio: boolean,
  studioOpened: boolean,
): boolean {
  return (editorEnabled === true || gateHeld) && (studio || studioOpened)
}

/** Shown: the Studio is the thing on screen, under the same open-or-held reading. */
export function studioGateShown(
  editorEnabled: boolean | undefined,
  gateHeld: boolean,
  studio: boolean,
): boolean {
  return studio && (editorEnabled === true || gateHeld)
}
