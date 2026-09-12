import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { languageForPath, languageIdsInUse } from './monacoLanguage'

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

  // --- the grammars the table was missing --------------------------------------------------------
  test('the C++ extensions monaco registers are all claimed', () => {
    for (const p of ['a.cpp', 'a.cc', 'a.cxx', 'a.hpp', 'a.hh', 'a.hxx']) {
      expect(languageForPath(p), p).toBe('cpp')
    }
    expect(languageForPath('a.c')).toBe('c')
    expect(languageForPath('a.h')).toBe('c')
  })
  test('the languages this bundle ships and the table did not claim', () => {
    expect(languageForPath('analysis.r')).toBe('r')
    expect(languageForPath('init.lua')).toBe('lua')
    expect(languageForPath('main.dart')).toBe('dart')
    expect(languageForPath('app.ex')).toBe('elixir')
    expect(languageForPath('test.exs')).toBe('elixir')
    expect(languageForPath('core.clj')).toBe('clojure')
    expect(languageForPath('core.cljs')).toBe('clojure')
    expect(languageForPath('deps.edn')).toBe('clojure')
    expect(languageForPath('Main.scala')).toBe('scala')
    expect(languageForPath('build.sbt')).toBe('scala')
    expect(languageForPath('Program.fs')).toBe('fsharp')
    expect(languageForPath('script.fsx')).toBe('fsharp')
  })

  // --- `.env` ------------------------------------------------------------------------------------
  describe('.env files highlight, including the variants people actually have', () => {
    test('the bare name, which has no extension to key on', () => {
      expect(languageForPath('.env')).toBe('ini')
      expect(languageForPath('packages/web/.env')).toBe('ini')
    })
    test('every variant, by PREFIX — the suffix is an environment name, not a known list', () => {
      for (const p of [
        '.env.local', '.env.production', '.env.example', '.env.config',
        '.env.development.local', '.env.whatever-this-project-calls-it',
      ]) {
        expect(languageForPath(p), p).toBe('ini')
      }
    })
    test('and `.envrc` is NOT one of them', () => {
      // direnv's file is a shell script. The trailing dot in the prefix test is what keeps it out,
      // along with `.environment` and anything else that merely starts with those four letters.
      expect(languageForPath('.envrc')).toBe('plaintext')
      expect(languageForPath('.environment')).toBe('plaintext')
    })
    test('an `.ini` or `.properties` file gets the same grammar by its extension', () => {
      expect(languageForPath('setup.ini')).toBe('ini')
      expect(languageForPath('app.properties')).toBe('ini')
    })
  })
})

/**
 * **EVERY ID IN THE TABLE IS ONE THE BUNDLE ACTUALLY REGISTERS.**
 *
 * This is the assertion the table existed three months without: `monaco.editor.createModel(text,
 * 'toml')` does not throw for a language nobody registered — it returns a model with no tokenizer —
 * so `toml`, `vue` and `makefile` all sat here naming grammars this bundle does not contain, and the
 * files rendered as plain text with the table insisting otherwise. The only way to tell is to ask
 * the package.
 *
 * The registered set is read the same way `monacoEntry.lint.test.ts` reads it: from the imports in
 * `monacoEntry.ts` (the one composition this app loads — a grammar in `node_modules` that nothing
 * imports is NOT in the bundle) and then from each of those `register.js` files' own `id:`, because a
 * directory name is not a language id — `languages/definitions/cpp/register.js` registers two (`c`
 * and `cpp`), and `objective-c`'s id carries its dash.
 */
describe('languageIdsAreRegistered', () => {
  const WEB = join(import.meta.dir, '../..')
  const VS_CANDIDATES = [
    join(WEB, 'node_modules', 'monaco-editor/package.json'),
    join(WEB, '../..', 'node_modules', 'monaco-editor/package.json'),
  ]

  function vsDir(): string | null {
    for (const pkg of VS_CANDIDATES) if (existsSync(pkg)) return join(dirname(pkg), 'esm/vs')
    return null
  }

  /** The language ids the composition in `monacoEntry.ts` puts in the bundle, plus `plaintext`. */
  function registeredIds(vs: string): Set<string> {
    const entry = readFileSync(join(import.meta.dir, 'monacoEntry.ts'), 'utf8')
    // Both the grammars (`languages/definitions/<dir>/register`) and the three language FEATURES
    // (`languages/features/<name>/register`) register languages; json's does it with
    // `languages.register({ id: "json" })` and the grammars with `registerLanguage({ id: 'x' })`,
    // hence the quote-agnostic match below.
    const specs = [...entry.matchAll(/'monaco-editor\/(languages\/(?:definitions|features)\/[^'/]+)\/register'/g)]
      .map(m => m[1]!)
    expect(specs.length).toBeGreaterThan(50)
    // `plaintext` is monaco's own built-in and is registered by the editor core, not by a grammar.
    const ids = new Set<string>(['plaintext'])
    for (const spec of specs) {
      const file = join(vs, `${spec}/register.js`)
      expect(existsSync(file), `monacoEntry.ts imports ${spec}, which is not in the package`).toBe(true)
      for (const m of readFileSync(file, 'utf8').matchAll(/\bid:\s*["']([^"']+)["']/g)) ids.add(m[1]!)
    }
    return ids
  }

  test('every language id this table can answer with is in the bundle', () => {
    const vs = vsDir()
    if (vs === null) {
      // Same stance as `monacoEntry.lint.test.ts`: without the package there is nothing to compare
      // against, and a green tick would be worse than a skip.
      throw new Error(`monaco-editor not installed; looked in:\n${VS_CANDIDATES.join('\n')}`)
    }
    const registered = registeredIds(vs)
    // The set is read, not assumed: if this ever comes back tiny, the parse above broke and every
    // assertion below would be vacuous.
    expect(registered.size).toBeGreaterThan(60)
    for (const id of languageIdsInUse()) {
      expect(registered.has(id), `language id "${id}" is registered by nothing in monacoEntry.ts`)
        .toBe(true)
    }
  })

  test('and the ids the table used to invent are gone', () => {
    // Pins the three corrections, so nobody reintroduces a language this bundle cannot colour.
    expect(languageIdsInUse()).not.toContain('toml')
    expect(languageIdsInUse()).not.toContain('vue')
    expect(languageIdsInUse()).not.toContain('makefile')
    expect(languageForPath('bunfig.toml')).toBe('ini')
    expect(languageForPath('App.vue')).toBe('html')
    expect(languageForPath('Makefile')).toBe('plaintext')
  })
})
