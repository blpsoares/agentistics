/**
 * railActivity.ts — PURE: which rail icons show the activity dot (addendum item 5, owner: "no live
 * precisa ficar alguma cor indicando que ta tendo algum tipo de atividade assim como subagents").
 *
 * ACTIVITY MEANS EXACTLY ONE THING, stated once here: the session's own live feed —
 * `artifactsStore.ts`'s `ArtifactLive`/`EdgeHint`, published from the transcript the app is ALREADY
 * polling for the session-metrics card's References section, never a client-side timer or interval
 * of this function's own — currently names something in flight. `live` lights for ANY hint (the
 * feed is doing something, full stop); `agents` lights only for `kind === 'delegated'`, the exact
 * hint this codebase already uses for "handed off to a subagent" (`SessionsPage.tsx`'s own
 * `HINT_VERB.delegated`/"delegando"). The two icons therefore read the SAME underlying fact at two
 * different grains rather than two independently invented signals that could disagree about what
 * "busy" means — which is also the literal reading of "like subagents already does": subagent
 * activity was already a NAMED CASE of this exact mechanism, `live` just never lit for it before.
 */

import type { PanelId } from './panelSlots'
import type { EdgeHint } from './artifactLayout'

/**
 * The set of rail panel ids that should show the activity dot right now, given the session's own
 * live hint (or `null` when nothing is in flight). Total: an absent hint returns an empty set,
 * never throws.
 */
export function railActivityFromHint(hint: EdgeHint | null | undefined): ReadonlySet<PanelId> {
  if (!hint) return new Set()
  const active = new Set<PanelId>(['live'])
  if (hint.kind === 'delegated') active.add('agents')
  return active
}
