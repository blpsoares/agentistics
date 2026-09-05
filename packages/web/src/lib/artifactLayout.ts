/**
 * artifactLayout.ts — PURE: where the artifacts panel goes, and what that costs the fleet list.
 *
 * Opening the panel COLLAPSES the session list to its rail, and the width comes from where it was
 * not being read: at the moment somebody opens a file to read it, the list is the least consulted
 * thing on screen. Measured at 1440px — list 248, rail 64, panel 440 — that is 936px of
 * conversation instead of 752.
 *
 * ONE CLICK DOING TWO THINGS is normally a defect, so the reversal sticks: `listExpandedByUser`
 * means the person opened the list back up with the panel open, and their choice WINS for as long
 * as it is set. The layout then degrades to a plain three-column split, which is the honest
 * arrangement it would have had anyway.
 *
 * Below `SPLIT_MIN_WIDTH` there is no room for three columns and the choice stops existing: the
 * panel becomes an overlay, and nothing is collapsed — collapsing a list the layout is not using
 * would be taking something for nothing.
 */

export type ArtifactLayout = 'closed' | 'split' | 'split-rail' | 'overlay' | 'fullscreen'

/** Below this there is no room for list, conversation and panel at once. */
export const SPLIT_MIN_WIDTH = 1100

/**
 * How long the panel takes to open and to close, and on what curve.
 *
 * THE SAME MOTION AS THE LEFT ASIDE, deliberately: two panels on one screen that slide at different
 * speeds read as two different applications. The numbers are the nav's own (`0.22s`, the same
 * ease-out curve), stated here so the pair can only ever be changed together.
 *
 * The duration is also the UNMOUNT delay — the panel has to still be on screen while it is
 * shrinking, so whatever reads this for the transition reads it for the timeout too. Two constants
 * would be two chances for the content to vanish before its box does.
 */
export const ASIDE_ANIM_MS = 220
export const ASIDE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

export interface ArtifactLayoutInput {
  open: boolean
  width: number
  isMobile: boolean
  /** The person re-opened the fleet list while the panel was up. Their choice outranks the default. */
  listExpandedByUser: boolean
}

export function resolveArtifactLayout(
  { open, width, isMobile, listExpandedByUser }: ArtifactLayoutInput,
): { layout: ArtifactLayout; collapseList: boolean } {
  if (!open) return { layout: 'closed', collapseList: false }
  // A phone has one column. Anything else would be two things sharing 390px, and the file is what
  // was asked for.
  if (isMobile) return { layout: 'fullscreen', collapseList: false }
  if (width < SPLIT_MIN_WIDTH) return { layout: 'overlay', collapseList: false }
  return listExpandedByUser
    ? { layout: 'split', collapseList: false }
    : { layout: 'split-rail', collapseList: true }
}

/**
 * Should the panel OPEN ITSELF right now?
 *
 * Asked for directly: "o modelo ta executando algo — automaticamente a barra deveria aparecer e
 * mostrar isso." A panel that appears while the session is writing is the difference between
 * watching work happen and going to look for it afterwards.
 *
 * THREE RULES, and the second is the one that makes it tolerable:
 *
 * 1. It fires on the TRANSITION into writing, never on the level — the same rule the fleet's bell
 *    keeps. On the level it would re-open on every poll for as long as the session was busy, which
 *    is a panel that cannot be closed.
 * 2. A panel the person CLOSED stays closed for that session. An automatic open is a suggestion,
 *    and a suggestion that overrides the answer it was given is not one. `dismissed` is what the
 *    caller sets when they close it, and only selecting a different session clears it.
 * 3. Never on a phone. There the panel is full-screen, so opening it by itself would cover the
 *    conversation somebody is reading, to show them a file they did not ask for.
 *
 * `writing` is the session actually touching a file — a `live` artifact — rather than merely being
 * `working`. A session thinking, searching or running tests has nothing to show here, and a panel
 * that opens on an empty list is worse than one that stays shut.
 */
export function shouldAutoOpen(
  { writing, wasWriting, open, dismissed, isMobile }: {
    writing: boolean
    wasWriting: boolean
    open: boolean
    dismissed: boolean
    isMobile: boolean
  },
): boolean {
  if (isMobile || open || dismissed) return false
  return writing && !wasWriting
}

/**
 * What the CLOSED panel should announce from the edge of the screen, if anything.
 *
 * Asked for: when the harness starts doing something, a marker on the right edge saying so, with
 * the panel shut — "se eu quero acompanhar", and clicking it opens the live view.
 *
 * IT IS THE LAST ACTION, NOT A COUNT. A badge saying "12" tells somebody that things happened; the
 * name of what is happening tells them whether they care. `null` when the panel is open (it is
 * already saying this, in full) or when there is nothing in flight — an always-present tab on the
 * edge becomes furniture, and furniture is not read.
 *
 * `live` is what makes it worth showing: an action from a turn that has FINISHED is history, and
 * history belongs in the panel somebody chose to open, not on the edge of a screen they are
 * reading something else in.
 */
export interface EdgeHint {
  /** The verb, already localized by the caller's own table. */
  kind: 'wrote' | 'read' | 'ran' | 'thought' | 'delegated'
  /** The path or command it names. */
  text: string
}

export function edgeHint(
  { open, events, isMobile }: {
    open: boolean
    events: readonly { kind: EdgeHint['kind']; text: string; live?: boolean }[]
    isMobile: boolean
  },
): EdgeHint | null {
  // On a phone the panel is full-screen; a tab on the edge would be a control promising to cover
  // the conversation somebody is reading.
  if (open || isMobile) return null
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!
    if (e.live) return { kind: e.kind, text: e.text }
  }
  return null
}
