import { describe, expect, test } from 'bun:test'
import { qrMatrix, qrSvg } from './qr'
import { QR_FIXTURES } from './qr.fixtures'

/**
 * The encoder is compared module-for-module against a reference implementation. Anything less
 * proves nothing: a QR with a wrong Reed-Solomon block, a mirrored format strip or the wrong
 * mask still LOOKS like a QR, and fails only when a phone is pointed at it.
 */
describe('qrMatrix', () => {
  for (const fixture of QR_FIXTURES) {
    test(`matches the reference symbol at version ${fixture.version}`, () => {
      const rows = qrMatrix(fixture.text).map(r => r.map(v => (v ? '1' : '0')).join(''))
      expect(rows.length).toBe(fixture.rows.length)
      // Row by row, so a failure names the row instead of dumping the whole symbol.
      for (let i = 0; i < fixture.rows.length; i++) {
        expect(`${i}: ${rows[i]}`).toBe(`${i}: ${fixture.rows[i]}`)
      }
    })
  }

  test('sizes the symbol as 4·version + 17', () => {
    for (const fixture of QR_FIXTURES) {
      expect(qrMatrix(fixture.text).length).toBe(fixture.version * 4 + 17)
    }
  })

  test('picks the smallest version that fits, and grows monotonically', () => {
    let previous = 0
    for (let len = 1; len <= 200; len += 7) {
      const size = qrMatrix('x'.repeat(len)).length
      expect(size).toBeGreaterThanOrEqual(previous)
      previous = size
    }
  })

  test('places the three finder patterns', () => {
    const m = qrMatrix('finders')
    const n = m.length
    for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) {
      expect(m[r0]![c0]).toBe(true)          // outer ring
      expect(m[r0 + 1]![c0 + 1]).toBe(false) // the white ring inside it
      expect(m[r0 + 3]![c0 + 3]).toBe(true)  // the 3×3 core
    }
  })

  test('refuses a payload larger than it can encode instead of truncating it', () => {
    // Silently dropping the tail would produce a scannable code carrying the WRONG secret.
    expect(() => qrMatrix('x'.repeat(5000))).toThrow(/exceeds version/)
  })
})

describe('qrSvg', () => {
  test('is self-contained and keeps the quiet zone', () => {
    const svg = qrSvg('otpauth://totp/Agentistics:me@example.com?secret=JBSWY3DPEHPK3PXP')
    const modules = qrMatrix('otpauth://totp/Agentistics:me@example.com?secret=JBSWY3DPEHPK3PXP').length
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain(`viewBox="0 0 ${modules + 8} ${modules + 8}"`) // 4 modules each side
    // No external anything: a strict CSP and an offline dashboard must both render it.
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/)
  })
})
