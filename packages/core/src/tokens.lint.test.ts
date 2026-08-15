import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * The fix that is not enforced is the fix that comes back.
 *
 * This bug was not one call site. `input + output` was summed as "tokens" in the session drawer, the
 * recent-sessions list, the CI tile and the Actions grouping, while the cockpit, the top-usage page
 * and the TUI selectors added all four — so the same session read 69,8K on one screen and 9,8M on
 * another. Nothing in the type system objects: all four fields are numbers, and adding two of them
 * is perfectly valid code that is quietly wrong by 300×.
 *
 * So the guard is a grep over the repo's own source, the same shape `billing-detect.test.ts` uses to
 * keep a module from naming a secret. Two shapes are refused:
 *
 *  1. **a sum of `input` and `output` with no cache counter in it** — the "tokens" that is not tokens;
 *  2. **a `calcCost` argument with the cache counters hardcoded to `0`** while input or output carry
 *     a real expression — a cost that silently prices only the cheap 4 % of the volume.
 *
 * Both have an escape hatch, because both are occasionally correct: a surface really may want the
 * conversation-only reading. It has to say so, in the source, with `@tokens-intentional` and a
 * reason on the same line — which turns a silent mistake into a decision somebody wrote down.
 */

const ROOT = join(import.meta.dir, '..', '..', '..')
const SCAN = ['packages/core/src', 'packages/server/server', 'packages/web/src', 'packages/tui/src']
const MARKER = '@tokens-intentional'

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    let entries: string[]
    try { entries = readdirSync(d) } catch { return }
    for (const name of entries) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) {
        if (name === 'node_modules' || name === 'dist') continue
        walk(p)
        continue
      }
      if (!/\.(ts|tsx)$/.test(name)) continue
      // Tests are exempt: a test asserting the WRONG arithmetic is how the right one is pinned, and
      // `tokens.test.ts` deliberately writes `input + output` to show what it is not.
      if (/\.test\.tsx?$/.test(name)) continue
      // Generated, and not ours to police.
      if (name.endsWith('.generated.ts')) continue
      out.push(p)
    }
  }
  walk(join(ROOT, dir))
  return out
}

/** The line a character offset falls on, 1-based — so a failure names a place to go. */
function lineAt(src: string, index: number): number {
  return src.slice(0, index).split('\n').length
}

/**
 * Whether the escape hatch is on the offending line or in the comment immediately above it.
 *
 * Six lines of lookback, because the marker is required to come WITH a reason and a reason is
 * prose that wraps. Three was not enough for the one genuine exemption in this repo, which is a
 * good sign about the size of a justification worth writing.
 */
function excused(src: string, index: number): boolean {
  const lines = src.split('\n')
  const n = lineAt(src, index)
  return lines.slice(Math.max(0, n - 7), n).some(l => l.includes(MARKER))
}

/**
 * Prose about the rule is not a breach of it.
 *
 * Half the modules touched by this fix now carry a comment explaining what `input + output` was and
 * why it is wrong — the guard flagging those would make the only honest documentation of the bug
 * impossible to write. A line whose first non-space character opens or continues a comment is skipped.
 */
function isComment(src: string, index: number): boolean {
  const line = src.split('\n')[lineAt(src, index) - 1] ?? ''
  return /^\s*(\/\/|\/\*|\*)/.test(line)
}

/**
 * A statement boundary inside the match means these were never one expression.
 *
 * This codebase writes no semicolons, so `[^;]` bounded nothing: `const inputTokens = …` on one
 * line and `const outputTokens = …` on the next matched as a "sum" and produced three confident
 * false positives. A declaration keyword between the two names is proof they are separate.
 */
function spansStatements(text: string): boolean {
  return /\b(const|let|var|function|return)\b/.test(text)
}

describe('no surface may add up two of the four token counters and call it "tokens"', () => {
  // `x.input_tokens ?? 0) + (y.output_tokens` and its camelCase twin, across a line break.
  //
  // `\+(?!=)` matters: `+=` is per-field ACCUMULATION (`acc.inputTokens += …` on one line,
  // `acc.outputTokens += …` on the next), which is the correct shape and keeps all four counters
  // apart. Matching it flagged eight innocent accumulators and would have taught the next reader
  // that this guard cries wolf.
  const SUM = /input_?[Tt]okens[^;\n]{0,120}?\+(?!=)[^;]{0,160}?output_?[Tt]okens/g

  it('finds no unexplained two-term token sum anywhere in the product', () => {
    const offences: string[] = []
    for (const dir of SCAN) {
      for (const file of sourceFiles(dir)) {
        const src = readFileSync(file, 'utf-8')
        for (const m of src.matchAll(SUM)) {
          const from = m.index!
          // The cache counters have to appear in the SAME expression. 260 characters is enough to
          // span the four-line form every correct call site in this repo is written in.
          const window = src.slice(from, from + 260)
          if (/cache_?[RrCc]/.test(window)) continue
          if (spansStatements(m[0])) continue
          if (isComment(src, from)) continue
          if (excused(src, from)) continue
          offences.push(`${relative(ROOT, file)}:${lineAt(src, from)}  ${m[0].replace(/\s+/g, ' ').slice(0, 90)}`)
        }
      }
    }
    expect(offences).toEqual([])
  })

  it('finds no calcCost argument that hardcodes the cache counters to zero', () => {
    // An accumulator initialised at all-zeros is fine and common; a usage object whose input or
    // output is a real expression while the cache sits at literal 0 is the drawer's bug.
    const USAGE = /\{[^{}]*?input[Tt]okens\s*:\s*([^,]+),[^{}]*?cacheReadInputTokens\s*:\s*0\s*[,}]/g
    const offences: string[] = []
    for (const dir of SCAN) {
      for (const file of sourceFiles(dir)) {
        const src = readFileSync(file, 'utf-8')
        for (const m of src.matchAll(USAGE)) {
          const value = (m[1] ?? '').trim()
          if (value === '0') continue          // a zeroed accumulator, not a measurement
          if (excused(src, m.index!)) continue
          offences.push(`${relative(ROOT, file)}:${lineAt(src, m.index!)}  inputTokens: ${value}`)
        }
      }
    }
    expect(offences).toEqual([])
  })

  it('actually scans a meaningful amount of source', () => {
    // A guard whose glob quietly matched nothing would pass forever. Pin the floor.
    const total = SCAN.reduce((n, d) => n + sourceFiles(d).length, 0)
    expect(total).toBeGreaterThan(200)
  })
})
