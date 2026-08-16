/**
 * org-team.ts — PURE: should first-boot create a team named after the organisation?
 *
 * When a central bootstraps its owner account it creates ONE team, named after `TEAM_ORG`, and
 * leaves it EMPTY. Every clause below is load-bearing:
 *
 *   - **Empty, and nobody is auto-joined** — not the owner, not anyone created afterwards. That is
 *     the whole difference between a convenience and a universal team, and a universal team was
 *     considered and REJECTED: team membership is the scope key for authorization, so a team
 *     everybody is in means everybody sees the team (and through `teamVisibleTo`, its roster), any
 *     manager of it manages the entire company, and any tag shared with it is shared with everyone.
 *     Creating the team is the convenience; POPULATING it is what would rebuild that. This module
 *     therefore only ever decides a NAME — it has no concept of a member.
 *
 *   - **Nothing at all for the placeholder org.** `TEAM_ORG` defaults to the literal `default`
 *     (`config.ts`), so a team named after it would be a team named after nobody's decision. Same
 *     `isNamedOrg` the connection card's title uses (`@agentistics/core/org`), so the two surfaces
 *     cannot disagree about what counts as a name.
 *
 *   - **It never auto-renames.** The guard is "does ANY team exist", not "does a team by this name
 *     exist": once the central has a team, this decides nothing ever again. Change the org config
 *     later and the team keeps the name it was given — it is an ordinary team from creation onward.
 *     A team that silently renamed itself because an env var moved would be alarming and
 *     impossible to reason about, and matching by name would quietly create a SECOND team the
 *     first time the org string changed.
 *
 *   - **Idempotent by construction**, which is what makes a reboot or a second bootstrap safe.
 */
import { isNamedOrg } from '@agentistics/core'

export type OrgTeamPlan =
  | { create: true; name: string }
  | { create: false; reason: 'unnamed-org' | 'teams-exist' }

export interface OrgTeamInput {
  /** `TEAM_ORG` as this central is configured. */
  org: string | undefined
  /** How many teams already exist. Anything above zero means this decision has been made. */
  existingTeams: number
}

export function planOrgTeam(input: OrgTeamInput): OrgTeamPlan {
  // The name question is asked FIRST: a placeholder org names nothing whatever the database holds.
  if (!isNamedOrg(input.org)) return { create: false, reason: 'unnamed-org' }
  if (input.existingTeams > 0) return { create: false, reason: 'teams-exist' }
  return { create: true, name: (input.org ?? '').trim() }
}
