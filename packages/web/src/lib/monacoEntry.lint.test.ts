import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * `monacoEntry.ts` IS A LIST, AND A LIST ROTS. This test is the thing that notices.
 *
 * The file composes Monaco from the package's published subpaths instead of its `monaco-editor`
 * barrel, for one measured reason: the barrel's TypeScript language service drags in a 6,914,791-byte
 * `ts.worker.js` that Vite emits at BUILD time whether a browser ever fetches it or not, and this
 * feature has that service switched off by design. Dropping it took the embedded web bundle from
 * 19,259.0 KB to 12,406.6 KB — a third of the `agentop` binary's web payload.
 *
 * Paying for that with a hand-maintained list of ~80 grammar imports buys two failure modes, and
 * NEITHER of them shows up in a build, a type check or a browser:
 *
 *  1. **A grammar upstream adds is a language that silently loses its colour here.** The build stays
 *     green, every other language still highlights, and the only symptom is a `.kt` file rendering
 *     in plain grey — which looks like nothing at all until somebody opens one.
 *  2. **The 6.9 MB comes back in one import.** Re-adding `languages/features/typescript/register`
 *     (or a `?worker` for `ts.worker`) is a one-line change that nothing else in the repo objects
 *     to, and the cost lands in the installer rather than on a screen.
 *
 * So both are asserted against the INSTALLED package and against the module's own source, in the
 * shape `tokens.lint.test.ts` and `billing-detect.test.ts` already use here. A monaco upgrade that
 * ships a new language now fails the build with the directory's name in the message.
 */

const WEB = join(import.meta.dir, '../..')
const ENTRY = join(import.meta.dir, 'monacoEntry.ts')
const SETUP = join(import.meta.dir, 'monacoSetup.ts')

/** monaco-editor is hoisted by bun, so resolve it rather than assuming a path. */
function monacoVsDir(): string | null {
  for (const dir of [join(WEB, 'node_modules'), join(WEB, '../..', 'node_modules')]) {
    const pkg = join(dir, 'monaco-editor/package.json')
    if (existsSync(pkg)) return join(dirname(pkg), 'esm/vs')
  }
  return null
}

describe('monacoEntry composes Monaco from subpaths', () => {
  const entry = readFileSync(ENTRY, 'utf8')
  const setup = readFileSync(SETUP, 'utf8')
  const vs = monacoVsDir()

  it('registers every Monarch grammar the installed monaco-editor ships', () => {
    if (!vs) return // no install to check against (a consumer of the published package)
    const onDisk = readdirSync(join(vs, 'languages/definitions'), { withFileTypes: true })
      .filter(d => d.isDirectory() && existsSync(join(vs, 'languages/definitions', d.name, 'register.js')))
      .map(d => d.name)
      .sort()
    const imported = [...entry.matchAll(/languages\/definitions\/([^/]+)\/register/g)].map(m => m[1]).sort()
    expect(onDisk.length).toBeGreaterThan(50) // a sanity floor: an empty read must not pass
    expect(imported).toEqual(onDisk)
  })

  it('still registers the grammars for the languages this app edits most', () => {
    for (const lang of ['typescript', 'javascript', 'css', 'html', 'markdown', 'yaml', 'python']) {
      expect(entry).toContain(`languages/definitions/${lang}/register`)
    }
  })

  it('keeps the json, css and html language services', () => {
    for (const feature of ['json', 'css', 'html']) {
      expect(entry).toContain(`monaco-editor/languages/features/${feature}/register`)
    }
  })

  it('never imports the TypeScript language service, in either file', () => {
    // The 6.9 MB. A comment may name it; an import may not.
    const importsOf = (src: string) =>
      [...src.matchAll(/^\s*(?:import|export)\s[^\n]*?['"]([^'"\n]+)['"]/gm)].map(m => m[1])
    for (const [name, src] of [['monacoEntry.ts', entry], ['monacoSetup.ts', setup]] as const) {
      for (const spec of importsOf(src)) {
        expect(`${name}: ${spec}`).not.toContain('features/typescript')
        expect(`${name}: ${spec}`).not.toContain('ts.worker')
      }
    }
  })

  it('never imports the monaco-editor barrel for a VALUE', () => {
    // `typeof import('monaco-editor')` in a type position is erased and is how `loadMonaco()` keeps
    // its public contract; a real import would put the whole barrel — ts.worker included — back.
    const valueImports = [...setup.matchAll(/^\s*(?:import|export)\s[^\n]*?['"]([^'"\n]+)['"]/gm)].map(m => m[1])
    expect(valueImports).not.toContain('monaco-editor')
    expect([...entry.matchAll(/^\s*(?:import|export)\s[^\n]*?['"]([^'"\n]+)['"]/gm)].map(m => m[1]))
      .not.toContain('monaco-editor')
  })

  it('bundles a worker for every language service it registers, and no others', () => {
    const workers = [...setup.matchAll(/from 'monaco-editor\/([^']+)\?worker'/g)].map(m => m[1])
    expect(workers.sort()).toEqual([
      'editor/editor.worker',
      'languages/features/css/css.worker',
      'languages/features/html/html.worker',
      'languages/features/json/json.worker',
    ])
  })
})
