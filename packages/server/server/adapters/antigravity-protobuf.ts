// packages/server/server/adapters/antigravity-protobuf.ts
//
// PURE, dependency-free, minimal protobuf wire-format reader for the Antigravity CLI's
// `gen_metadata.data` BLOBs (~/.gemini/antigravity-cli/conversations/<conversation-id>.db).
//
// Verified wire layout (decoded from the real bytes on a live machine, and CHECKED AGAINST THE
// PROVIDER'S OWN BILLING CONSOLE — see "How the mapping was established" below):
//
//   data
//    └─ field 1  (LEN, submessage: generation info)
//        ├─ field 4  (LEN, submessage: token usage)
//        │    ├─ field 1  varint  system_instruction_tokens  CONSTANT per install — NEVER a sum
//        │    ├─ field 2  varint  input_tokens          (fresh / uncached prompt)
//        │    ├─ field 3  varint  output_tokens         (TOTAL output; == f9 + f10)
//        │    ├─ field 5  varint  cached_tokens         (context-cache READ)
//        │    ├─ field 9  varint  thinking_tokens
//        │    └─ field 10 varint  completion_tokens     (visible answer)
//        ├─ field 9  (LEN, submessage: request info)
//        │    └─ field 10 (LEN, submessage: context)
//        │         ├─ field 1  varint  context_tokens   (context SIZE gauge, never additive)
//        │         └─ field 4  varint  context_window   (the window agy itself declares)
//        ├─ field 19 (LEN, string) technical model id   e.g. "gemini-3.6-flash"
//        └─ field 21 (LEN, string) display model name   e.g. "Gemini 3.6 Flash (Medium)"
//
// CRITICAL: field 1.4.3 ALREADY includes field 1.4.9 — never add thinking to output.
//
// ## How the mapping was established (and why the earlier one was wrong)
//
// The first version of this reader mapped 1.4.1 → input, 1.4.2 → cache and 1.4.5 → a context
// gauge. Every one of those was wrong, and the errors compounded: agy reported 52,6 mi tokens
// where the provider billed ~250 mi, and R$111 against R$703.
//
// The tell is in the data itself: across 2.966 rows on a real machine, **1.4.1 is the constant
// 1072** (min === max). A per-call input count cannot be constant, so that field is the fixed
// system-instruction size and belongs in no sum at all.
//
// The rest was settled by measurement, not by reading field numbers off a guess — the provider's
// console reports the same project this machine feeds, split by model:
//
//                       this machine (1.4.2 / 1.4.5 / 1.4.3)   provider console (gemini-3.6-flash)
//   input                            48.281.400                 54.448.878  (live)
//   cache                           200.401.323                199.363.144  (live)
//   output                            1.100.635                  1.219.673  (live)
//   % cache                               80,6 %                      78,5 %
//
// and per DAY against the console's own chart: 2026-08-14 → R$44,94 here vs ~R$45 there;
// 2026-08-15 → R$479,91 vs ~R$465. The residual (~18 %) is a second machine feeding the same
// project plus two days this machine has no DB for. No other assignment of these fields lands
// anywhere near: reading 1.9.10.1 as the billed prompt gives 283,97 mi (+24 % over the console's
// total) and puts % cache at 70,6; keeping 1.4.2 as the cache gives 17 %.
//
// So 1.9.10.1 is what it looks like — the context SIZE at that call, which grows to 127.968
// against the 128.000 in 1.9.10.4 beside it. It is the gauge, and summing it would be exactly the
// mistake this comment warns about for 1.4.5's old reading.
//
// 1.9.10.4 is the window agy DECLARES for the call (128.000, and 256.000 on some rows). It is
// treated like Codex's `model_context_window`: a harness stating the window for the session it is
// running outranks any table, which is what lets an agy session draw a context bar at all —
// Google publishes no citable input limit, so `CONTEXT_WINDOWS` has no row to fall back to.
//
// Contract: this module NEVER throws. Malformed / truncated / garbage input yields `null`
// (or partially-filled zeros) so the caller can degrade to "no tokens" instead of failing.

/** Decoded token usage + model identity of a single `gen_metadata` row. */
export interface GenMetadata {
  /** field 1.4.2 — fresh (uncached) input tokens. Additive. */
  inputTokens: number
  /** field 1.4.5 — context-cache read tokens. Additive, and ~80 % of agy's prompt volume. */
  cachedTokens: number
  /** field 1.4.3 — TOTAL output tokens (thinking + completion). Additive. */
  outputTokens: number
  /** field 1.4.9 — thinking tokens. Already inside `outputTokens`; never sum separately. */
  thinkingTokens: number
  /** field 1.4.10 — visible completion tokens. Already inside `outputTokens`. */
  completionTokens: number
  /**
   * field 1.4.1 — the system-instruction size. CONSTANT for an install (1072 on the machine this
   * was verified against, on every one of 2.966 rows). Decoded so the constancy stays visible and
   * checkable; it is deliberately NOT part of any token sum.
   */
  systemInstructionTokens: number
  /** field 1.9.10.1 — context size at this generation. A GAUGE, never summed. */
  contextTokens: number
  /** field 1.9.10.4 — the context window agy declares for this call. 0 when absent. */
  contextWindow: number
  /** field 1.19 — technical model id, e.g. `gemini-3.6-flash`. */
  modelId: string
  /** field 1.21 — human display name, e.g. `Gemini 3.6 Flash (Medium)`. */
  modelDisplay: string
}

const WIRE_VARINT = 0
const WIRE_FIXED64 = 1
const WIRE_LEN = 2
const WIRE_FIXED32 = 5

/** Cursor over a byte range. Mutated in place by the readers below. */
interface Cursor {
  buf: Uint8Array
  pos: number
  end: number
}

/**
 * Read a base-128 varint. Returns `null` on truncation or on an over-long encoding
 * (>10 bytes, which cannot be a valid 64-bit varint).
 *
 * Values are returned as JS numbers: token counts are far below 2^53, and a bogus huge
 * value is rejected by the caller's sanity check rather than silently corrupting a sum.
 */
function readVarint(c: Cursor): number | null {
  let result = 0
  let shift = 1
  let bytes = 0
  while (c.pos < c.end) {
    const byte = c.buf[c.pos++]!
    // Accumulate by multiplication (not <<) so values above 2^31 stay correct.
    result += (byte & 0x7f) * shift
    if ((byte & 0x80) === 0) return Number.isFinite(result) ? result : null
    shift *= 128
    if (++bytes >= 10) return null // malformed: varints are at most 10 bytes
  }
  return null // truncated
}

/** Skip a field of the given wire type. Returns false when the field cannot be skipped. */
function skipField(c: Cursor, wireType: number): boolean {
  switch (wireType) {
    case WIRE_VARINT:
      return readVarint(c) !== null
    case WIRE_FIXED64:
      if (c.pos + 8 > c.end) return false
      c.pos += 8
      return true
    case WIRE_FIXED32:
      if (c.pos + 4 > c.end) return false
      c.pos += 4
      return true
    case WIRE_LEN: {
      const len = readVarint(c)
      if (len === null || len < 0 || c.pos + len > c.end) return false
      c.pos += len
      return true
    }
    default:
      // Wire types 3/4 (deprecated groups) and 6/7 (invalid) — cannot be skipped safely.
      return false
  }
}

/** Read a length-delimited field's byte range. Returns null on truncation. */
function readLenRange(c: Cursor): { start: number; end: number } | null {
  const len = readVarint(c)
  if (len === null || len < 0 || c.pos + len > c.end) return null
  const start = c.pos
  c.pos += len
  return { start, end: start + len }
}

/** Decode a UTF-8 byte range as a string; never throws. */
function decodeUtf8(buf: Uint8Array, start: number, end: number): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(start, end))
  } catch {
    return ''
  }
}

/** Token counts above this are treated as corruption, not data (agy calls are ~1e5 tokens). */
const MAX_PLAUSIBLE_TOKENS = 1_000_000_000

function sane(n: number | null): number {
  if (n === null || !Number.isFinite(n) || n < 0 || n > MAX_PLAUSIBLE_TOKENS) return 0
  return n
}

/** Parse the inner token-usage submessage (field 1.4) into `out`. */
function readTokenUsage(buf: Uint8Array, start: number, end: number, out: GenMetadata): void {
  const c: Cursor = { buf, pos: start, end }
  while (c.pos < c.end) {
    const key = readVarint(c)
    if (key === null) return
    const fieldNo = Math.floor(key / 8)
    const wireType = key % 8
    if (wireType === WIRE_VARINT) {
      const v = readVarint(c)
      if (v === null) return
      switch (fieldNo) {
        case 1: out.systemInstructionTokens = sane(v); break
        case 2: out.inputTokens = sane(v); break
        case 3: out.outputTokens = sane(v); break
        case 5: out.cachedTokens = sane(v); break
        case 9: out.thinkingTokens = sane(v); break
        case 10: out.completionTokens = sane(v); break
        default: break // field 6 and any future field: ignored on purpose
      }
      continue
    }
    if (!skipField(c, wireType)) return
  }
}

/** Parse the context submessage (field 1.9.10) into `out`. */
function readContextInfo(buf: Uint8Array, start: number, end: number, out: GenMetadata): void {
  const c: Cursor = { buf, pos: start, end }
  while (c.pos < c.end) {
    const key = readVarint(c)
    if (key === null) return
    const fieldNo = Math.floor(key / 8)
    const wireType = key % 8
    if (wireType === WIRE_VARINT) {
      const v = readVarint(c)
      if (v === null) return
      if (fieldNo === 1) out.contextTokens = sane(v)
      else if (fieldNo === 4) out.contextWindow = sane(v)
      continue
    }
    if (!skipField(c, wireType)) return
  }
}

/** Parse the request-info submessage (field 1.9) into `out`. Only field 10 is of interest. */
function readRequestInfo(buf: Uint8Array, start: number, end: number, out: GenMetadata): void {
  const c: Cursor = { buf, pos: start, end }
  while (c.pos < c.end) {
    const key = readVarint(c)
    if (key === null) return
    const fieldNo = Math.floor(key / 8)
    const wireType = key % 8
    if (wireType === WIRE_LEN) {
      const range = readLenRange(c)
      if (range === null) return
      if (fieldNo === 10) readContextInfo(buf, range.start, range.end, out)
      continue
    }
    if (!skipField(c, wireType)) return
  }
}

/** Parse the generation-info submessage (field 1) into `out`. */
function readGenerationInfo(buf: Uint8Array, start: number, end: number, out: GenMetadata): void {
  const c: Cursor = { buf, pos: start, end }
  while (c.pos < c.end) {
    const key = readVarint(c)
    if (key === null) return
    const fieldNo = Math.floor(key / 8)
    const wireType = key % 8
    if (wireType === WIRE_LEN) {
      const range = readLenRange(c)
      if (range === null) return
      if (fieldNo === 4) readTokenUsage(buf, range.start, range.end, out)
      else if (fieldNo === 9) readRequestInfo(buf, range.start, range.end, out)
      else if (fieldNo === 19) out.modelId = decodeUtf8(buf, range.start, range.end)
      else if (fieldNo === 21) out.modelDisplay = decodeUtf8(buf, range.start, range.end)
      continue
    }
    if (!skipField(c, wireType)) return
  }
}

function emptyGenMetadata(): GenMetadata {
  return {
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    completionTokens: 0,
    systemInstructionTokens: 0,
    contextTokens: 0,
    contextWindow: 0,
    modelId: '',
    modelDisplay: '',
  }
}

/**
 * Decode one `gen_metadata.data` BLOB.
 *
 * Returns `null` when the input is absent/empty or contains nothing recognizable, so the
 * caller can skip the row. Never throws: a truncated or garbage blob yields either `null`
 * or the subset of fields that decoded cleanly before the damage.
 */
export function parseGenMetadataBlob(data: Uint8Array | null | undefined): GenMetadata | null {
  if (!data || typeof (data as Uint8Array).length !== 'number' || data.length === 0) return null
  let buf: Uint8Array
  try {
    buf = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayLike<number>)
  } catch {
    return null
  }

  const out = emptyGenMetadata()
  let sawAnything = false
  const c: Cursor = { buf, pos: 0, end: buf.length }
  while (c.pos < c.end) {
    const key = readVarint(c)
    if (key === null) break
    const fieldNo = Math.floor(key / 8)
    const wireType = key % 8
    if (fieldNo === 1 && wireType === WIRE_LEN) {
      const range = readLenRange(c)
      if (range === null) break
      readGenerationInfo(buf, range.start, range.end, out)
      sawAnything = true
      continue
    }
    if (!skipField(c, wireType)) break
  }

  if (!sawAnything) return null
  return out
}
