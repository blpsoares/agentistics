/**
 * ingest-batch.ts — PURE. How many sessions one ingest request carries, and how long it is given.
 *
 * These two numbers were chosen independently and nothing checked that they fit each other, which
 * is the whole bug. A batch of 200 was posted under a flat 15s timeout whose own comment asserted
 * "15s is generous enough for a legitimately slow link pushing a full 200-session batch" — an
 * assumption nobody had measured. Against a real remote central the cost is ~195 ms per session,
 * so 200 sessions need ~39 s. Every first push aborted at 15 s.
 *
 * That alone would be a slow-recovery bug. What made it permanent is that **a batch is the unit of
 * durable progress**: `pushOnceDetailed` advances the sent-state only after the central ACCEPTS a
 * batch, so a batch that can never complete records nothing, and the next cycle re-sends the same
 * 200 sessions. Measured on the machine that surfaced this: 1.260 consecutive failures, a
 * sent-state still `{}`, and `lastSuccessAt: null` — a member that had never once pushed while its
 * central answered every other request in under a second.
 *
 * Two rules follow, and the first is the one that matters:
 *
 *  1. **The timeout is DERIVED from the batch**, never stated beside it. `ingestTimeoutMs(n)` is
 *     the only place either number is decided, so they cannot drift apart again.
 *  2. **The batch adapts to what the central can actually do.** A derived timeout still rests on an
 *     estimate of ms-per-session, and an estimate is a guess about someone else's hardware. A
 *     central slower than the guess must converge rather than retry the same impossible request, so
 *     a failed push HALVES the batch and a successful one grows it back toward the ceiling.
 *
 * The ceiling is deliberately far below the old 200. Smaller batches cost round trips and buy
 * durable progress: with 50, a member that can only finish four batches before the network drops
 * keeps those four. With 200 it kept nothing.
 */

/** Largest batch to attempt. A member starts here and adapts down if the central cannot keep up. */
export const MAX_BATCH_SIZE = 50

/**
 * Smallest batch to fall back to. Not 1: a per-session round trip turns a full history into
 * hundreds of requests, and a central that cannot absorb 5 sessions inside
 * `ingestTimeoutMs(5)` is broken in a way a smaller batch will not fix.
 */
export const MIN_BATCH_SIZE = 5

/**
 * Per-session budget. Measured at ~195 ms/session against a real remote central (Mongo upserts +
 * stats + SSE fan-out, over the public internet); 300 ms leaves headroom without inviting a
 * request that occupies a concurrency slot for minutes.
 */
export const PER_SESSION_MS = 300

/** Fixed cost of any request: DNS, TLS, proxy hops, and the central's own routing. */
export const BASE_TIMEOUT_MS = 15_000

/**
 * Hard ceiling on a single ingest.
 *
 * The timeout exists in the first place so a wedged reverse proxy or a suspended container — which
 * accepts the TCP connection and then never answers — cannot hold a `MAX_CONCURRENT_PUSHES` slot
 * forever and starve every other connection. A derived timeout must therefore still be bounded, or
 * a large batch would quietly reintroduce exactly that.
 */
export const MAX_TIMEOUT_MS = 60_000

/**
 * How long a batch of `n` sessions is given. The ONLY place this is decided.
 *
 * `n <= 0` still gets the base timeout: the empty-delta push (statsCache + workflows only) is a
 * real request with a real cost.
 */
export function ingestTimeoutMs(batchSize: number): number {
  const n = Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : 0
  return Math.min(MAX_TIMEOUT_MS, BASE_TIMEOUT_MS + n * PER_SESSION_MS)
}

/** Clamp any stored/injected batch size into the usable range. */
export function clampBatchSize(size: number): number {
  if (!Number.isFinite(size)) return MAX_BATCH_SIZE
  return Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_SIZE, Math.floor(size)))
}

/**
 * The batch size to use after a push attempt.
 *
 * Halve on failure, grow by a quarter on success — the batch settles just under whatever the
 * central can actually absorb instead of oscillating between the ceiling and the floor.
 *
 * Growth is deliberately not a jump back to `MAX_BATCH_SIZE`: on a central that is permanently
 * slower than `PER_SESSION_MS` assumes, that would fail at the ceiling, drop to the floor, and fail
 * again forever — the same non-convergence in a slower loop.
 */
export function nextBatchSize(current: number, outcome: 'ok' | 'failed'): number {
  const size = clampBatchSize(current)
  if (outcome === 'failed') return clampBatchSize(Math.floor(size / 2))
  // `+1` so growth cannot stall on a size whose quarter floors to zero.
  return clampBatchSize(Math.floor(size * 1.25) + 1)
}
