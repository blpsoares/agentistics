/**
 * rotate-claim.ts — **pure**: the one step of a token rotation that MUST NOT race.
 *
 * A machine's identity IS the hash of its token (`memberId = sha256(token)`), so rotating means
 * swapping one id for another and dragging every collection keyed by it along (see
 * `rotate-identity.ts` for that enumeration). `rotateToken` used to do the swap LAST: read the old
 * doc, migrate sessions/stats/workflows/tags/keys, then insert the new doc and delete the old one.
 * Two overlapping rotations of the same machine therefore both read the same old doc and both
 * inserted a replacement — ONE machine became TWO, the second owning nothing and holding a token
 * only the person who double-clicked ever saw. The Rotate button had no confirm and no in-flight
 * guard, so overlapping rotations were one impatient click away, and the fleet list grew a row per
 * click.
 *
 * So the swap moves to the FRONT and becomes a claim exactly one caller can win. The order is
 * insert-then-take, not take-then-insert, deliberately:
 *   - insert → take: a crash between the two leaves a DUPLICATE, which an operator can see and
 *     delete.
 *   - take → insert: a crash between the two leaves the machine with NO token doc at all — its
 *     sessions still keyed by an id nothing points at, and no way to reconstruct the metadata.
 * A visible extra row beats a silently missing machine, and the window is one round-trip wide.
 *
 * The loser rolls its own replacement back and reports a loss; the caller treats that exactly like
 * "no such machine", because that is what it is by the time it looked.
 */

/** The minimal tokens-collection surface a claim needs. Declared as an interface so the ordering
 *  above is a property of a tested function rather than of a comment — this suite has no Mongo. */
export interface RotationClaimStore<D extends { _id: string }> {
  findOne(id: string): Promise<D | null>
  insert(doc: D): Promise<void>
  /** MUST be atomic: of N concurrent callers, exactly one may receive the document.
   *  Mongo's `findOneAndDelete` is. A `findOne` followed by a `deleteOne` is NOT. */
  takeIfPresent(id: string): Promise<D | null>
  remove(id: string): Promise<void>
}

export type RotationClaim<D> =
  /** This caller owns the rotation; `doc` is the machine, already stored under its new id. */
  | { won: true; doc: D }
  /** Someone else got there first, or the machine is gone. Nothing of this caller's remains. */
  | { won: false }

export async function claimRotation<D extends { _id: string }>(
  store: RotationClaimStore<D>,
  oldId: string,
  newId: string,
): Promise<RotationClaim<D>> {
  const doc = await store.findOne(oldId)
  if (!doc) return { won: false }

  const replacement = { ...doc, _id: newId }
  await store.insert(replacement)

  // The one atomic step. Whoever removes the old row owns the rotation and everything keyed by it.
  const taken = await store.takeIfPresent(oldId)
  if (!taken) {
    // Lost: another rotation already claimed this machine and is migrating its history to ITS new
    // id. Leaving this replacement in place is exactly the duplicate machine being fixed here.
    await store.remove(newId).catch(() => { /* best-effort; a stray row is visible and deletable */ })
    return { won: false }
  }

  return { won: true, doc: replacement }
}
