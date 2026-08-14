/**
 * event-rotate.ts — PURE. How the inbox stops growing, and how a reader picks up where it left off.
 *
 * ## The cursor is a pair, and it has to be
 *
 * "Read everything since I last looked" is the whole reason the inbox exists — a Claude session
 * only runs when it is invoked, so events that happened while it was parked have to be waiting for
 * it somewhere. The cheap way to express "since" is a byte offset, and a byte offset is exactly
 * what rotation invalidates: after the file is rolled over, offset 8000 points at an unrelated
 * event, or past the end.
 *
 * So a cursor is `{ offset, seq }`. `seq` is monotonic within one file and restarts at 1 after a
 * rotation, and `planRead` cross-checks them: a cursor whose offset is past the end of the file, or
 * whose sequence is ahead of what the file now holds, is a cursor from BEFORE a rotation. That case
 * reads from the beginning and SAYS SO (`rotated: true`) rather than returning nothing — a reader
 * told "no new events" when the file was rolled under it would go quiet forever.
 *
 * ## One previous generation is kept
 *
 * Rotation renames the file to `.1`, replacing whatever `.1` held. Keeping exactly one generation
 * is the honest middle: enough that a rotation mid-read does not destroy the events being read,
 * bounded so the channel cannot fill a disk. What falls off the end is gone, and `status` reports
 * the rotation count so that is visible rather than assumed.
 */

/** Roll over past this many bytes. Two MiB is roughly 10k events — weeks of a busy fleet. */
export const MAX_INBOX_BYTES = 2 * 1024 * 1024

export interface EventCursor {
  /** Byte offset into the CURRENT inbox file. */
  offset: number
  /** The `seq` of the last event read. 0 means "nothing read yet". */
  seq: number
}

export const EMPTY_CURSOR: EventCursor = { offset: 0, seq: 0 }

/** Should the file be rolled over before this write? */
export function planRotation(currentBytes: number, incomingBytes: number, max = MAX_INBOX_BYTES): boolean {
  // Rotate BEFORE the write that would exceed the cap, not after — so the cap is a cap, and a
  // single very large write cannot leave the file permanently over it.
  return currentBytes > 0 && currentBytes + incomingBytes > max
}

export interface ReadPlan {
  /** Where to start reading the current file. */
  from: number
  /**
   * The cursor could not be honoured — the file was rotated (or truncated) under the reader, so
   * this read starts at the beginning and some events are gone. Reported, never silent.
   */
  rotated: boolean
}

/**
 * Where to start reading, given a cursor and what the file looks like now.
 *
 * `latestSeq` is the highest sequence the file currently holds; a caller that does not know it
 * passes `undefined` and only the offset check applies.
 */
export function planRead(cursor: EventCursor, fileBytes: number, latestSeq?: number): ReadPlan {
  if (cursor.offset < 0 || cursor.seq < 0) return { from: 0, rotated: true }
  // The file is SHORTER than where we stopped: it was rotated or truncated.
  if (cursor.offset > fileBytes) return { from: 0, rotated: true }
  // The file no longer reaches the sequence we had already read: same thing, caught in the case
  // where the new file happens to be longer than the old offset.
  if (latestSeq !== undefined && cursor.seq > 0 && latestSeq < cursor.seq) return { from: 0, rotated: true }
  return { from: cursor.offset, rotated: false }
}

/** The cursor a reader should keep after consuming up to `offset`. */
export function advanceCursor(offset: number, lastSeq: number): EventCursor {
  return { offset, seq: lastSeq }
}
