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
export type TagSourceType = 'repo' | 'project' | 'machine' | 'team' | 'account'

/** Repo and project lead because they are what anyone actually reaches for. */
const MACHINE_TYPES: TagSourceType[] = ['repo', 'project']
const CENTRAL_TYPES: TagSourceType[] = ['repo', 'project', 'machine', 'team', 'account']

export function tagSourceTypes(isCentral: boolean): TagSourceType[] {
  return isCentral ? CENTRAL_TYPES : MACHINE_TYPES
}
