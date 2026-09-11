import { describe, expect, test } from 'bun:test'
import { languageForPath } from './monacoLanguage'

describe('languageForPath', () => {
  test('maps common extensions to Monaco language ids', () => {
    expect(languageForPath('src/a.ts')).toBe('typescript')
    expect(languageForPath('src/a.tsx')).toBe('typescript')
    expect(languageForPath('src/a.js')).toBe('javascript')
    expect(languageForPath('a.json')).toBe('json')
    expect(languageForPath('README.md')).toBe('markdown')
    expect(languageForPath('style.css')).toBe('css')
    expect(languageForPath('index.html')).toBe('html')
    expect(languageForPath('script.py')).toBe('python')
    expect(languageForPath('main.go')).toBe('go')
    expect(languageForPath('lib.rs')).toBe('rust')
  })
  test('is case-insensitive on the extension', () => {
    expect(languageForPath('A.TS')).toBe('typescript')
  })
  test('Dockerfile has no extension and is matched by its bare name', () => {
    expect(languageForPath('Dockerfile')).toBe('dockerfile')
    expect(languageForPath('deploy/Dockerfile')).toBe('dockerfile')
  })
  test('an unknown extension falls back to plaintext, never throws', () => {
    expect(languageForPath('data.xyz123')).toBe('plaintext')
  })
  test('a file with no extension at all is plaintext', () => {
    expect(languageForPath('LICENSE')).toBe('plaintext')
  })
})
