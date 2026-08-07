/** PURE: which source dimensions a tag may be built from, here.
 *
 *  `team` and `account` need IAM, which only a central has — they were already hidden off one.
 *  `machine` is the same kind of thing and was not: off a central there is exactly ONE machine, so
 *  the picker offered a single entry, "This machine", whose tag would cover every session on it.
 *  That is not a tag, it is "everything", asked for in a way that reads like a real choice — and it
 *  invited the question "why am I picking a machine while I AM the machine?".
 *
 *  Hiding it from the PICKER does not hide it from a tag that already carries it: a machine source
 *  written on a central still resolves and still renders its label. This is about what can be
 *  built here, not about what can be read here. */
export type TagSourceType = 'repo' | 'project' | 'machine' | 'team' | 'account' | 'harness' | 'model' | 'user'

/** Repo and project lead because they are what anyone actually reaches for. Harness and model
 *  follow — session ATTRIBUTES, not identity, so unlike machine/team/account they mean the same
 *  thing solo and on a central and are offered in both.
 *
 *  `user` is excluded from the solo/machine list on purpose, not by the same "reads as everything"
 *  reasoning as `machine` above: `SessionMeta.user` is only ever set in team mode (central-ingested
 *  sessions carry an owning user; a local/solo session has none), so a `user` tag built here would
 *  match zero sessions forever — offering it would be a picker option that silently cannot work. */
const MACHINE_TYPES: TagSourceType[] = ['repo', 'project', 'harness', 'model']
const CENTRAL_TYPES: TagSourceType[] = ['repo', 'project', 'harness', 'model', 'user', 'machine', 'team', 'account']

export function tagSourceTypes(isCentral: boolean): TagSourceType[] {
  return isCentral ? CENTRAL_TYPES : MACHINE_TYPES
}
