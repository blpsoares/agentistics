import { test, expect } from 'bun:test'
import { parseGenMetadataBlob } from './antigravity-protobuf'

// --- tiny hand-rolled protobuf ENCODER, used only to build test fixtures -----

function varint(n: number): number[] {
  const out: number[] = []
  let v = n
  while (v >= 128) {
    out.push((v % 128) + 128)
    v = Math.floor(v / 128)
  }
  out.push(v)
  return out
}

/** wire type 0 */
function vfield(fieldNo: number, value: number): number[] {
  return [...varint(fieldNo * 8 + 0), ...varint(value)]
}

/** wire type 2 */
function lfield(fieldNo: number, bytes: number[]): number[] {
  return [...varint(fieldNo * 8 + 2), ...varint(bytes.length), ...bytes]
}

function str(s: string): number[] {
  return [...new TextEncoder().encode(s)]
}

/** Build a blob shaped exactly like a real gen_metadata.data row. */
function buildBlob(o: {
  input?: number, cached?: number, output?: number, context?: number,
  thinking?: number, completion?: number, modelId?: string, modelDisplay?: string,
}): Uint8Array {
  const usage = [
    ...vfield(1, o.input ?? 0),
    ...vfield(2, o.cached ?? 0),
    ...vfield(3, o.output ?? 0),
    ...vfield(5, o.context ?? 0),
    ...vfield(6, 24), // unknown constant present in the real data — must be ignored
    ...vfield(9, o.thinking ?? 0),
    ...vfield(10, o.completion ?? 0),
  ]
  const gen = [
    ...lfield(4, usage),
    ...lfield(19, str(o.modelId ?? '')),
    ...lfield(21, str(o.modelDisplay ?? '')),
  ]
  return new Uint8Array(lfield(1, gen))
}

// ---------------------------------------------------------------------------

test('decodes the verified real row 0 (input 1072 / cached 22504 / output 472)', () => {
  const blob = buildBlob({
    input: 1072, cached: 22504, output: 472, thinking: 401, completion: 71,
    modelId: 'gemini-3.6-flash', modelDisplay: 'Gemini 3.6 Flash (Medium)',
  })
  expect(parseGenMetadataBlob(blob)).toEqual({
    inputTokens: 1072,
    cachedTokens: 22504,
    outputTokens: 472,
    thinkingTokens: 401,
    completionTokens: 71,
    totalContextTokens: 0,
    modelId: 'gemini-3.6-flash',
    modelDisplay: 'Gemini 3.6 Flash (Medium)',
  })
})

test('output already contains thinking — the reader never adds them', () => {
  const m = parseGenMetadataBlob(buildBlob({ output: 472, thinking: 401, completion: 71 }))!
  expect(m.outputTokens).toBe(472)
  expect(m.thinkingTokens + m.completionTokens).toBe(m.outputTokens)
})

test('field 5 (context size) is reported separately and never folded into a sum', () => {
  const m = parseGenMetadataBlob(buildBlob({ input: 10, output: 20, context: 20366 }))!
  expect(m.totalContextTokens).toBe(20366)
  expect(m.inputTokens).toBe(10)
  expect(m.outputTokens).toBe(20)
})

test('multi-byte varints above 2^21 decode correctly', () => {
  const m = parseGenMetadataBlob(buildBlob({ cached: 3_000_000, output: 268_435_456 }))!
  expect(m.cachedTokens).toBe(3_000_000)
  expect(m.outputTokens).toBe(268_435_456)
})

test('unknown fields of every wire type are skipped, not fatal', () => {
  const usage = [...vfield(1, 5), ...vfield(3, 7)]
  const gen = [
    ...varint(7 * 8 + 5), 1, 2, 3, 4,             // fixed32 unknown
    ...varint(8 * 8 + 1), 1, 2, 3, 4, 5, 6, 7, 8, // fixed64 unknown
    ...vfield(9, 999),                             // varint unknown
    ...lfield(12, str('ignored')),                 // LEN unknown
    ...lfield(4, usage),
    ...lfield(19, str('gemini-3.6-flash')),
  ]
  const m = parseGenMetadataBlob(new Uint8Array(lfield(1, gen)))!
  expect(m.inputTokens).toBe(5)
  expect(m.outputTokens).toBe(7)
  expect(m.modelId).toBe('gemini-3.6-flash')
})

test('empty / absent input returns null', () => {
  expect(parseGenMetadataBlob(null)).toBeNull()
  expect(parseGenMetadataBlob(undefined)).toBeNull()
  expect(parseGenMetadataBlob(new Uint8Array(0))).toBeNull()
})

test('a truncated blob never throws and yields at most partial data', () => {
  const full = buildBlob({
    input: 1072, cached: 22504, output: 472, thinking: 401, completion: 71,
    modelId: 'gemini-3.6-flash',
  })
  for (let cut = 1; cut < full.length; cut++) {
    const m = parseGenMetadataBlob(full.subarray(0, cut))
    if (m === null) continue
    // Whatever survived must still be sane, never negative or fabricated.
    expect(m.inputTokens).toBeGreaterThanOrEqual(0)
    expect(m.outputTokens).toBeGreaterThanOrEqual(0)
    expect(m.inputTokens).toBeLessThanOrEqual(1072)
  }
})

test('garbage bytes never throw', () => {
  const cases = [
    new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    new Uint8Array([0x0a, 0xff, 0xff, 0xff]),          // field 1 LEN with a bogus length
    new Uint8Array([0x0a, 0x7f, 0x01]),                // length longer than the buffer
    new Uint8Array([0x1c, 0x1c, 0x1c]),                // wire type 4 (deprecated group end)
    new Uint8Array(Array.from({ length: 64 }, (_, i) => (i * 37) % 256)),
  ]
  for (const c of cases) {
    expect(() => parseGenMetadataBlob(c)).not.toThrow()
  }
})

test('an implausibly huge token count is treated as corruption, not data', () => {
  const usage = [...vfield(1, Number.MAX_SAFE_INTEGER)]
  const m = parseGenMetadataBlob(new Uint8Array(lfield(1, lfield(4, usage))))!
  expect(m.inputTokens).toBe(0)
})

test('a blob with no field 1 at all returns null', () => {
  expect(parseGenMetadataBlob(new Uint8Array(vfield(2, 7)))).toBeNull()
})
