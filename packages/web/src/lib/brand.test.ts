import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { brandAsset, isCentralShell, type BrandAsset } from './brand'

const PUBLIC = join(import.meta.dir, '..', '..', 'public')
const ASSETS: BrandAsset[] = ['/minimalistLogo.png', '/logo.png', '/logo-light.png']

describe('brand', () => {
  test('a machine shows the amber marks unchanged', () => {
    for (const a of ASSETS) expect(brandAsset(a, false)).toBe(a)
  })
  test('a central shows a DIFFERENT file for every mark, and each one exists', () => {
    for (const a of ASSETS) {
      const c = brandAsset(a, true)
      expect(c).not.toBe(a)
      expect(existsSync(join(PUBLIC, c))).toBe(true)
    }
  })
  test('only data-central="1" reads as a central', () => {
    expect(isCentralShell({ dataset: { central: '1' } })).toBe(true)
    expect(isCentralShell({ dataset: {} })).toBe(false)
    expect(isCentralShell(null)).toBe(false)
  })
})
