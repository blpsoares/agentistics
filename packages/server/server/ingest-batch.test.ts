import { test, expect } from 'bun:test'
import {
  MAX_BATCH_SIZE, MIN_BATCH_SIZE, PER_SESSION_MS, BASE_TIMEOUT_MS, MAX_TIMEOUT_MS,
  ingestTimeoutMs, clampBatchSize, nextBatchSize,
} from './ingest-batch'

// --- the regression this module exists for --------------------------------------------------

test('a full batch fits its own timeout at the measured cost of a real central', () => {
  // The bug: BATCH_SIZE 200 under a flat 15s timeout, against a central costing ~195 ms/session.
  // 200 × 195 ms = 39s > 15s, so the first batch aborted every single time — and because the
  // sent-state only advances on an ACCEPTED batch, nothing was ever recorded and the same 200
  // were re-sent forever (measured: 1.260 consecutive failures, sent-state still empty).
  const MEASURED_MS_PER_SESSION = 195
  const cost = MAX_BATCH_SIZE * MEASURED_MS_PER_SESSION
  expect(cost).toBeLessThan(ingestTimeoutMs(MAX_BATCH_SIZE))

  // And the old pairing must still read as impossible, so nobody restores it by halves.
  expect(200 * MEASURED_MS_PER_SESSION).toBeGreaterThan(15_000)
})

test('the timeout is derived from the batch, so the two cannot drift apart', () => {
  expect(ingestTimeoutMs(10)).toBe(BASE_TIMEOUT_MS + 10 * PER_SESSION_MS)
  expect(ingestTimeoutMs(MAX_BATCH_SIZE)).toBeGreaterThan(ingestTimeoutMs(MIN_BATCH_SIZE))
})

test('an empty batch still gets the base timeout — it is a real request', () => {
  // The empty-delta push carries statsCache + workflows and costs the central real work.
  expect(ingestTimeoutMs(0)).toBe(BASE_TIMEOUT_MS)
  expect(ingestTimeoutMs(-5)).toBe(BASE_TIMEOUT_MS)
  expect(ingestTimeoutMs(Number.NaN)).toBe(BASE_TIMEOUT_MS)
})

test('the derived timeout stays bounded, so a slot is always released', () => {
  // The timeout exists so a wedged proxy cannot hold a MAX_CONCURRENT_PUSHES slot forever.
  // Deriving it must not quietly reintroduce an unbounded wait.
  expect(ingestTimeoutMs(1_000_000)).toBe(MAX_TIMEOUT_MS)
  expect(ingestTimeoutMs(MAX_BATCH_SIZE)).toBeLessThanOrEqual(MAX_TIMEOUT_MS)
})

// --- adaptation ------------------------------------------------------------------------------

test('a failed push halves the batch, down to the floor', () => {
  expect(nextBatchSize(50, 'failed')).toBe(25)
  expect(nextBatchSize(25, 'failed')).toBe(12)
  expect(nextBatchSize(MIN_BATCH_SIZE, 'failed')).toBe(MIN_BATCH_SIZE)
})

test('a successful push grows the batch, up to the ceiling', () => {
  expect(nextBatchSize(MIN_BATCH_SIZE, 'ok')).toBeGreaterThan(MIN_BATCH_SIZE)
  expect(nextBatchSize(MAX_BATCH_SIZE, 'ok')).toBe(MAX_BATCH_SIZE)
})

test('growth never stalls — every size below the ceiling strictly increases', () => {
  // `Math.floor(size * 1.25)` alone stalls at small sizes (5 → 6 → 7 is fine, but a quarter that
  // floors to zero would pin the batch at the floor forever on a central that then recovers).
  for (let n = MIN_BATCH_SIZE; n < MAX_BATCH_SIZE; n++) {
    expect(nextBatchSize(n, 'ok')).toBeGreaterThan(n)
  }
})

test('a permanently slow central converges instead of retrying an impossible request', () => {
  // A central that can only absorb 8 sessions inside its budget. Shrink on failure, grow on
  // success: the size must settle at something it can actually complete, and must not oscillate
  // back to the ceiling forever (which is the same non-convergence in a slower loop).
  const CAPACITY = 8
  let size = MAX_BATCH_SIZE
  const seen: number[] = []
  for (let cycle = 0; cycle < 60; cycle++) {
    const ok = size <= CAPACITY
    size = nextBatchSize(size, ok ? 'ok' : 'failed')
    if (cycle >= 20) seen.push(size)
  }
  // Past the settling period every size it reaches is one the central can serve, or one step above
  // it — never anywhere near the ceiling.
  expect(Math.max(...seen)).toBeLessThanOrEqual(CAPACITY + 3)
  expect(seen.some(s => s <= CAPACITY)).toBe(true)
})

test('a central that recovers gets its throughput back', () => {
  let size: number = MIN_BATCH_SIZE
  for (let i = 0; i < 40; i++) size = nextBatchSize(size, 'ok')
  expect(size).toBe(MAX_BATCH_SIZE)
})

// --- clamping --------------------------------------------------------------------------------

test('any stored or injected size is clamped into the usable range', () => {
  expect(clampBatchSize(0)).toBe(MIN_BATCH_SIZE)
  expect(clampBatchSize(-100)).toBe(MIN_BATCH_SIZE)
  expect(clampBatchSize(10_000)).toBe(MAX_BATCH_SIZE)
  expect(clampBatchSize(Number.NaN)).toBe(MAX_BATCH_SIZE)
  expect(clampBatchSize(12.9)).toBe(12)
})

test('the ceiling is far below the old 200 — a batch is the unit of durable progress', () => {
  // Smaller batches cost round trips and buy durable progress: the sent-state advances per
  // ACCEPTED batch, so a member whose network drops mid-push keeps what it already landed.
  expect(MAX_BATCH_SIZE).toBeLessThan(200)
  expect(MIN_BATCH_SIZE).toBeGreaterThan(1) // a per-session round trip is not the answer either
})
