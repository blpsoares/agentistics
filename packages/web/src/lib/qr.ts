/**
 * qr.ts — a QR symbol for the 2FA enrolment screen: byte mode, error correction level M,
 * versions 1-10 (an otpauth:// URI lands around version 8).
 *
 * Written out rather than pulled in as a dependency, which is why the screen shipped with a
 * typable key and no QR at all: every authenticator does accept manual entry, but the operator
 * transcribing 32 base32 characters by hand is the step that fails, and it fails as an
 * indistinguishable "invalid code".
 *
 * PURE and unit-tested by comparing the full module matrix, version by version, against the
 * `qrcode` reference implementation (see qr.test.ts). A home-grown encoder that merely looks
 * like a QR scans as nothing, and you find that out with a phone in your hand.
 */

/** Data codewords per block, per version, at ECC level M (the standard block table). */
const EC_BLOCKS: Record<number, { ec: number; g1: number; d1: number; g2: number; d2: number }> = {
  1: { ec: 10, g1: 1, d1: 16, g2: 0, d2: 0 },
  2: { ec: 16, g1: 1, d1: 28, g2: 0, d2: 0 },
  3: { ec: 26, g1: 1, d1: 44, g2: 0, d2: 0 },
  4: { ec: 18, g1: 2, d1: 32, g2: 0, d2: 0 },
  5: { ec: 24, g1: 2, d1: 43, g2: 0, d2: 0 },
  6: { ec: 16, g1: 4, d1: 27, g2: 0, d2: 0 },
  7: { ec: 18, g1: 4, d1: 31, g2: 0, d2: 0 },
  8: { ec: 22, g1: 2, d1: 38, g2: 2, d2: 39 },
  9: { ec: 22, g1: 3, d1: 36, g2: 2, d2: 37 },
  10: { ec: 26, g1: 4, d1: 43, g2: 1, d2: 44 },
}

/** Alignment-pattern centre coordinates per version (none for version 1). */
const ALIGNMENT: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
}

/** Unused bits after the codeword stream, which exist because the symbol is not a whole number
 *  of codewords. Getting this wrong shifts nothing visibly — it just fails to scan. */
const REMAINDER_BITS: Record<number, number> = {
  1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0,
}

const MAX_VERSION = 10

// ---------------------------------------------------------------------------
// GF(256) — Reed-Solomon over the QR field (primitive polynomial 0x11d)
// ---------------------------------------------------------------------------

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a]! + LOG[b]!]!
}

/** The generator polynomial for `degree` error-correction codewords. */
function rsGenerator(degree: number): number[] {
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0)
    // Coefficients run highest-degree first: multiplying by (x + α^i) shifts poly[j] up one
    // degree (same index in the longer array) and scales it into the next index.
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] ?? 0) ^ poly[j]!
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(poly[j]!, EXP[i]!)
    }
    poly = next
  }
  return poly
}

function rsRemainder(data: number[], degree: number): number[] {
  const gen = rsGenerator(degree)
  const rem = new Array<number>(degree).fill(0)
  for (const byte of data) {
    const factor = byte ^ rem[0]!
    rem.shift()
    rem.push(0)
    for (let j = 0; j < degree; j++) rem[j] = rem[j]! ^ gfMul(gen[j + 1]!, factor)
  }
  return rem
}

// ---------------------------------------------------------------------------
// Bit stream → interleaved codewords
// ---------------------------------------------------------------------------

function totalDataCodewords(version: number): number {
  const b = EC_BLOCKS[version]!
  return b.g1 * b.d1 + b.g2 * b.d2
}

/** The smallest version that holds `len` bytes in byte mode at level M. */
function pickVersion(len: number): number {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const ccBits = v <= 9 ? 8 : 16
    const needed = 4 + ccBits + 8 * len
    if (needed <= totalDataCodewords(v) * 8) return v
  }
  throw new Error(`qr: ${len} bytes exceeds version ${MAX_VERSION} at ECC level M`)
}

function buildCodewords(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = []
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }

  push(0b0100, 4) // byte mode
  push(bytes.length, version <= 9 ? 8 : 16)
  for (const b of bytes) push(b, 8)

  const capacityBits = totalDataCodewords(version) * 8
  push(0, Math.min(4, capacityBits - bits.length)) // terminator
  while (bits.length % 8 !== 0) bits.push(0)

  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]!
    data.push(byte)
  }
  // Pad alternately with the two codewords the spec names, until the block is full.
  const pad = [0xec, 0x11]
  for (let i = 0; data.length < totalDataCodewords(version); i++) data.push(pad[i % 2]!)

  // Split into blocks, compute EC per block, then interleave data and EC separately.
  const { ec, g1, d1, g2, d2 } = EC_BLOCKS[version]!
  const dataBlocks: number[][] = []
  const ecBlocks: number[][] = []
  let offset = 0
  for (let i = 0; i < g1 + g2; i++) {
    const size = i < g1 ? d1 : d2
    const block = data.slice(offset, offset + size)
    offset += size
    dataBlocks.push(block)
    ecBlocks.push(rsRemainder(block, ec))
  }

  const out: number[] = []
  const maxData = Math.max(d1, d2)
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]!)
  }
  for (let i = 0; i < ec; i++) {
    for (const block of ecBlocks) out.push(block[i]!)
  }
  return out
}

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

type Grid = { size: number; mod: Uint8Array; fn: Uint8Array }

const at = (g: Grid, r: number, c: number) => g.mod[r * g.size + c]!
const set = (g: Grid, r: number, c: number, dark: boolean, isFn = false) => {
  g.mod[r * g.size + c] = dark ? 1 : 0
  if (isFn) g.fn[r * g.size + c] = 1
}
const reserved = (g: Grid, r: number, c: number) => g.fn[r * g.size + c] === 1

function placeFinder(g: Grid, row: number, col: number): void {
  // The 7×7 finder plus its one-module separator, clipped at the symbol edge.
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r, cc = col + c
      if (rr < 0 || rr >= g.size || cc < 0 || cc >= g.size) continue
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6))
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4
      set(g, rr, cc, inRing || inCore, true)
    }
  }
}

function buildFunctionPatterns(version: number): Grid {
  const size = version * 4 + 17
  const g: Grid = { size, mod: new Uint8Array(size * size), fn: new Uint8Array(size * size) }

  placeFinder(g, 0, 0)
  placeFinder(g, 0, size - 7)
  placeFinder(g, size - 7, 0)

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    set(g, 6, i, i % 2 === 0, true)
    set(g, i, 6, i % 2 === 0, true)
  }

  // Alignment patterns, except where they would collide with a finder.
  const centres = ALIGNMENT[version]!
  for (const r of centres) {
    for (const c of centres) {
      const nearFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)
      if (nearFinder) continue
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc))
          set(g, r + dr, c + dc, ring !== 1, true)
        }
      }
    }
  }

  // Dark module + the two format-information strips (values written after masking).
  set(g, size - 8, 8, true, true)
  for (let i = 0; i < 9; i++) {
    if (!reserved(g, 8, i)) set(g, 8, i, false, true)
    if (!reserved(g, i, 8)) set(g, i, 8, false, true)
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved(g, 8, size - 1 - i)) set(g, 8, size - 1 - i, false, true)
    if (!reserved(g, size - 1 - i, 8)) set(g, size - 1 - i, 8, false, true)
  }

  // Version information (two 6×3 blocks) exists from version 7 on.
  if (version >= 7) {
    const bits = versionBits(version)
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1
      const a = Math.floor(i / 3)
      const b = (i % 3) + size - 11
      set(g, a, b, dark, true)
      set(g, b, a, dark, true)
    }
  }
  return g
}

/** BCH(18,6) version information — computed, not tabulated. */
function versionBits(version: number): number {
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return ((version << 12) | rem) >>> 0
}

/** BCH(15,5) format information for ECC level M (bits 00) and a mask, XOR-masked per the spec. */
function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return (((data << 10) | rem) ^ 0x5412) >>> 0
}

function placeFormatBits(g: Grid, mask: number): void {
  const bits = formatBits(mask)
  const size = g.size
  // Both copies run MOST-significant bit first along their path.
  const bit = (k: number) => ((bits >>> (14 - k)) & 1) === 1

  // Copy 1: left to right under the top-left finder, then bottom to top beside it.
  let k = 0
  for (let c = 0; c <= 5; c++) set(g, 8, c, bit(k++), true)
  set(g, 8, 7, bit(k++), true)
  set(g, 8, 8, bit(k++), true)
  set(g, 7, 8, bit(k++), true)
  for (let r = 5; r >= 0; r--) set(g, r, 8, bit(k++), true)

  // Copy 2: seven modules climbing from the bottom-left finder, then eight running right
  // under the top-right one. The module at (size-8, 8) is NOT part of it — it is the dark
  // module, always set, which is why this half is 7+8 and not 8+7.
  k = 0
  for (let i = 0; i < 7; i++) set(g, size - 1 - i, 8, bit(k++), true)
  for (let i = 0; i < 8; i++) set(g, 8, size - 8 + i, bit(k++), true)
  set(g, size - 8, 8, true, true)
}

/** The eight mask conditions, by index. */
function maskAt(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0
    case 1: return r % 2 === 0
    case 2: return c % 3 === 0
    case 3: return (r + c) % 3 === 0
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  }
}

/** Zigzag placement of the codeword stream, skipping function modules and the timing column. */
function placeData(g: Grid, codewords: number[], remainder: number): void {
  const size = g.size
  const bits: number[] = []
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1)
  for (let i = 0; i < remainder; i++) bits.push(0)

  let idx = 0
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    const rightCol = right <= 6 ? right - 1 : right // column 6 is the vertical timing pattern
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step
      for (const c of [rightCol, rightCol - 1]) {
        if (reserved(g, r, c)) continue
        g.mod[r * size + c] = (bits[idx++] ?? 0) as number
      }
    }
    upward = !upward
  }
}

function applyMask(g: Grid, mask: number): void {
  for (let r = 0; r < g.size; r++) {
    for (let c = 0; c < g.size; c++) {
      if (reserved(g, r, c)) continue
      if (maskAt(mask, r, c)) g.mod[r * g.size + c] = at(g, r, c) ^ 1
    }
  }
}

/** The spec's four penalty rules; the mask with the lowest total wins. */
function penalty(g: Grid): number {
  const size = g.size
  let score = 0

  const runScore = (line: number[]): number => {
    let s = 0
    let run = 1
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) {
        run++
      } else {
        if (run >= 5) s += 3 + (run - 5)
        run = 1
      }
    }
    if (run >= 5) s += 3 + (run - 5)
    return s
  }

  const FINDER_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0]
  const FINDER_B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
  const patternScore = (line: number[]): number => {
    let s = 0
    for (let i = 0; i + 11 <= line.length; i++) {
      const win = line.slice(i, i + 11)
      if (win.every((v, j) => v === FINDER_A[j]) || win.every((v, j) => v === FINDER_B[j])) s += 40
    }
    return s
  }

  for (let r = 0; r < size; r++) {
    const row: number[] = []
    for (let c = 0; c < size; c++) row.push(at(g, r, c))
    score += runScore(row) + patternScore(row)
  }
  for (let c = 0; c < size; c++) {
    const col: number[] = []
    for (let r = 0; r < size; r++) col.push(at(g, r, c))
    score += runScore(col) + patternScore(col)
  }

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = at(g, r, c)
      if (v === at(g, r, c + 1) && v === at(g, r + 1, c) && v === at(g, r + 1, c + 1)) score += 3
    }
  }

  let dark = 0
  for (let i = 0; i < g.mod.length; i++) dark += g.mod[i]!
  const percent = (dark * 100) / (size * size)
  score += Math.floor(Math.abs(percent - 50) / 5) * 10
  return score
}

/**
 * The QR modules for `text` as rows of booleans (true = dark), without a quiet zone.
 * Throws only when the text is too long for version 10 at ECC level M.
 */
export function qrMatrix(text: string, forceMask?: number): boolean[][] {
  const bytes = new TextEncoder().encode(text)
  const version = pickVersion(bytes.length)
  const codewords = buildCodewords(bytes, version)

  let best: Grid | null = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    if (forceMask !== undefined && mask !== forceMask) continue
    const g = buildFunctionPatterns(version)
    placeData(g, codewords, REMAINDER_BITS[version]!)
    applyMask(g, mask)
    placeFormatBits(g, mask)
    const score = penalty(g)
    if (score < bestScore) { bestScore = score; best = g }
  }

  const g = best!
  const out: boolean[][] = []
  for (let r = 0; r < g.size; r++) {
    const row: boolean[] = []
    for (let c = 0; c < g.size; c++) row.push(at(g, r, c) === 1)
    out.push(row)
  }
  return out
}

/**
 * The matrix as a self-contained SVG string (no external anything), with the 4-module quiet
 * zone the spec requires — a QR rendered flush to its container does not scan reliably.
 * Colours are passed in so the caller can follow the theme.
 */
export function qrSvg(text: string, opts: { dark?: string; light?: string; quiet?: number } = {}): string {
  const m = qrMatrix(text)
  const quiet = opts.quiet ?? 4
  const dark = opts.dark ?? '#000000'
  const light = opts.light ?? '#ffffff'
  const size = m.length + quiet * 2
  let path = ''
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m.length; c++) {
      if (m[r]![c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/>` +
    `</svg>`
  )
}
