// packages/server/server/adapters/antigravity-protobuf.ts
//
// PURE, dependency-free, minimal protobuf wire-format reader for the Antigravity CLI's
// `gen_metadata.data` BLOBs (~/.gemini/antigravity-cli/conversations/<conversation-id>.db).
//
// Verified wire layout (decoded from the real bytes on a live machine):
//
//   data
//    └─ field 1  (LEN, submessage: generation info)
//        ├─ field 4  (LEN, submessage: token usage)
//        │    ├─ field 1  varint  input_tokens          (non-cached input)
//        │    ├─ field 2  varint  cached_tokens         (context-cache read)
//        │    ├─ field 3  varint  output_tokens         (TOTAL output; == f9 + f10)
//        │    ├─ field 5  varint  total_context_tokens  (context SIZE gauge, never additive)
//        │    ├─ field 9  varint  thinking_tokens
//        │    └─ field 10 varint  completion_tokens     (visible answer)
//        ├─ field 19 (LEN, string) technical model id   e.g. "gemini-3.6-flash"
//        └─ field 21 (LEN, string) display model name   e.g. "Gemini 3.6 Flash (Medium)"
//
// CRITICAL: field 3 ALREADY includes field 9 — never add thinking to output.
//
// Contract: this module NEVER throws. Malformed / truncated / garbage input yields `null`
// (or partially-filled zeros) so the caller can degrade to "no tokens" instead of failing.

/** Decoded token usage + model identity of a single `gen_metadata` row. */
export interface GenMetadata {
  /** field 1.4.1 — non-cached input tokens. */
  inputTokens: number
  /** field 1.4.2 — context-cache read tokens. */
  cachedTokens: number
  /** field 1.4.3 — TOTAL output tokens (thinking + completion). Additive. */
  outputTokens: number
  /** field 1.4.9 — thinking tokens. Already inside `outputTokens`; never sum separately. */
  thinkingTokens: number
  /** field 1.4.10 — visible completion tokens. Already inside `outputTokens`. */
  completionTokens: number
  /** field 1.4.5 — context-window size at this generation. A GAUGE, never summed. */
  totalContextTokens: number
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
        case 1: out.inputTokens = sane(v); break
        case 2: out.cachedTokens = sane(v); break
        case 3: out.outputTokens = sane(v); break
        case 5: out.totalContextTokens = sane(v); break
        case 9: out.thinkingTokens = sane(v); break
        case 10: out.completionTokens = sane(v); break
        default: break // field 6 and any future field: ignored on purpose
      }
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
    totalContextTokens: 0,
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
