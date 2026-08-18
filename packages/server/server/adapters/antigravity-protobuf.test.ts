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

/**
 * Build a blob shaped exactly like a real gen_metadata.data row.
 *
 * The parameter names are the SEMANTICS, not the field numbers, and the mapping below is the one
 * verified against the provider's billing console: input is `1.4.2`, cache is `1.4.5`, and `1.4.1`
 * is the constant system-instruction size that belongs in no sum.
 */
function buildBlob(o: {
  input?: number, cached?: number, output?: number,
  systemInstruction?: number, context?: number, window?: number,
  thinking?: number, completion?: number, modelId?: string, modelDisplay?: string,
}): Uint8Array {
  const usage = [
    ...vfield(1, o.systemInstruction ?? 0),
    ...vfield(2, o.input ?? 0),
    ...vfield(3, o.output ?? 0),
    ...vfield(5, o.cached ?? 0),
    ...vfield(6, 24), // unknown constant present in the real data — must be ignored
    ...vfield(9, o.thinking ?? 0),
    ...vfield(10, o.completion ?? 0),
  ]
  const gen = [
    ...lfield(4, usage),
    ...lfield(9, lfield(10, [...vfield(1, o.context ?? 0), ...vfield(4, o.window ?? 0)])),
    ...lfield(19, str(o.modelId ?? '')),
    ...lfield(21, str(o.modelDisplay ?? '')),
  ]
  return new Uint8Array(lfield(1, gen))
}

// ---------------------------------------------------------------------------

test('decodes a verified real row (input 18804 / cached 17105 / output 472)', () => {
  const blob = buildBlob({
    systemInstruction: 1072, input: 18804, cached: 17105, output: 472, thinking: 401, completion: 71,
    context: 30125, window: 128_000,
    modelId: 'gemini-3.6-flash', modelDisplay: 'Gemini 3.6 Flash (Medium)',
  })
  expect(parseGenMetadataBlob(blob)).toEqual({
    inputTokens: 18804,
    cachedTokens: 17105,
    outputTokens: 472,
    thinkingTokens: 401,
    completionTokens: 71,
    systemInstructionTokens: 1072,
    contextTokens: 30125,
    contextWindow: 128_000,
    modelId: 'gemini-3.6-flash',
    modelDisplay: 'Gemini 3.6 Flash (Medium)',
  })
})

test('field 1.4.1 is the constant system-instruction size, NOT the input count', () => {
  // The regression this whole mapping exists to prevent. On the machine the fields were verified
  // against, 1.4.1 was 1072 on every one of 2.966 rows while the real input varied per call; the
  // adapter summed the constant and reported 52,6 mi tokens where the provider billed ~250 mi.
  // A constant can never be a per-call counter, so it must never reach `inputTokens`.
  const a = parseGenMetadataBlob(buildBlob({ systemInstruction: 1072, input: 2810 }))!
  const b = parseGenMetadataBlob(buildBlob({ systemInstruction: 1072, input: 76273 }))!
  expect(a.systemInstructionTokens).toBe(1072)
  expect(b.systemInstructionTokens).toBe(1072)
  expect(a.inputTokens).toBe(2810)
  expect(b.inputTokens).toBe(76273)
})

test('the context gauge and the declared window come from 1.9.10, not from the usage message', () => {
  const m = parseGenMetadataBlob(buildBlob({ input: 8011, cached: 70131, context: 91958, window: 256_000 }))!
  expect(m.contextTokens).toBe(91958)
  expect(m.contextWindow).toBe(256_000)
  // The gauge is a LEVEL and sits apart from the two additive counters beside it.
  expect(m.inputTokens).toBe(8011)
  expect(m.cachedTokens).toBe(70131)
})

test('a row with no 1.9.10 reports no window rather than a guessed one', () => {
  const gen = [...lfield(4, [...vfield(2, 500), ...vfield(3, 20)]), ...lfield(19, str('gemini-3.6-flash'))]
  const m = parseGenMetadataBlob(new Uint8Array(lfield(1, gen)))!
  expect(m.contextTokens).toBe(0)
  expect(m.contextWindow).toBe(0)
  expect(m.inputTokens).toBe(500)
})

test('output already contains thinking — the reader never adds them', () => {
  const m = parseGenMetadataBlob(buildBlob({ output: 472, thinking: 401, completion: 71 }))!
  expect(m.outputTokens).toBe(472)
  expect(m.thinkingTokens + m.completionTokens).toBe(m.outputTokens)
})

test('field 1.4.5 is the cache READ — the biggest counter agy produces', () => {
  // ~80 % of agy's prompt volume lands here (80,6 % measured over 2.966 rows, against the 78,5 %
  // the provider's console reports for the same project). Reading it as a context gauge, as the
  // first version of this module did, dropped four fifths of the billed tokens on the floor.
  const m = parseGenMetadataBlob(buildBlob({ input: 8011, cached: 70131, output: 183 }))!
  expect(m.cachedTokens).toBe(70131)
  expect(m.inputTokens).toBe(8011)
  expect(m.outputTokens).toBe(183)
})

test('multi-byte varints above 2^21 decode correctly', () => {
  const m = parseGenMetadataBlob(buildBlob({ cached: 3_000_000, output: 268_435_456 }))!
  expect(m.cachedTokens).toBe(3_000_000)
  expect(m.outputTokens).toBe(268_435_456)
})

test('unknown fields of every wire type are skipped, not fatal', () => {
  const usage = [...vfield(2, 5), ...vfield(3, 7)]
  const gen = [
    ...varint(7 * 8 + 5), 1, 2, 3, 4,             // fixed32 unknown
    ...varint(8 * 8 + 1), 1, 2, 3, 4, 5, 6, 7, 8, // fixed64 unknown
    ...vfield(11, 999),                            // varint unknown
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
    systemInstruction: 1072, input: 1072, cached: 22504, output: 472, thinking: 401, completion: 71,
    context: 30125, window: 128_000, modelId: 'gemini-3.6-flash',
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
  const usage = [...vfield(2, Number.MAX_SAFE_INTEGER)]
  const m = parseGenMetadataBlob(new Uint8Array(lfield(1, lfield(4, usage))))!
  expect(m.inputTokens).toBe(0)
})

test('a blob with no field 1 at all returns null', () => {
  expect(parseGenMetadataBlob(new Uint8Array(vfield(2, 7)))).toBeNull()
})
