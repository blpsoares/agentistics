/**
 * rebuild-flags.ts — PURE resolution of the two answers a rebuild needs, and nothing else.
 *
 * Two questions used to be answered by accident rather than by the user:
 *
 *  1. `central.sh up` asks "central.env exists. Re-run interactive setup? [y/N]" whenever stdin is
 *     a terminal, so a rebuild the user wanted unattended stopped and waited for a keypress. It was
 *     only ever skipped by the `[ -t 0 ]` accident — a streamed child has no stdin, so the control
 *     center never saw the prompt and nobody noticed the CLI did. `-y` / `-n` state the answer;
 *     giving both is a user error, not something to silently pick a side on.
 *  2. A rebuild reused Docker's layer cache, so `--rebuild` could produce an image byte-identical
 *     to the one before it. A rebuild is a rebuild: `cache` defaults to `'fresh'` on the rebuild
 *     paths (`rebuildFlags`), with `--cache` as the escape hatch — `--no-cache` means a full
 *     `bun install` + Vite build inside the container every time, which is genuinely slow.
 *
 * The shell receives an ALREADY-DECIDED answer: every branch lives here, `central.sh` only obeys.
 * Nothing in this file touches the filesystem, the network or `process` — it is argv in, argv out.
 */

/** Whether to re-run `central.sh`'s interactive setup, when the user said. */
export type SetupAnswer = 'yes' | 'no'
/** Whether the image build may reuse Docker's layer cache. */
export type CacheChoice = 'reuse' | 'fresh'

/** What the user asked for. Both optional: absent means "did not say". */
export interface RebuildFlags {
  setup?: SetupAnswer
  cache?: CacheChoice
}

/** A pair of flags that contradict each other, in the spelling the user typed the canonical one. */
export type FlagConflict = readonly [string, string]

export type RebuildFlagsResult =
  | { ok: true; flags: RebuildFlags; rest: string[] }
  | { ok: false; conflict: FlagConflict }

const SETUP_FLAGS: Record<string, SetupAnswer> = {
  '-y': 'yes',
  '--yes': 'yes',
  '-n': 'no',
  '--no': 'no',
}

const CACHE_FLAGS: Record<string, CacheChoice> = {
  '--cache': 'reuse',
  '--no-cache': 'fresh',
}

/**
 * Read the rebuild flags out of an argv, leaving everything else untouched in `rest`.
 *
 * Repeating the same answer is fine (`-y --yes`); asking for both is refused rather than resolved,
 * because either choice would be a guess at what the user meant and one of them re-runs a wizard
 * that overwrites central.env.
 */
export function parseRebuildFlags(argv: readonly string[]): RebuildFlagsResult {
  const flags: RebuildFlags = {}
  const rest: string[] = []
  for (const arg of argv) {
    const setup = SETUP_FLAGS[arg]
    if (setup) {
      if (flags.setup && flags.setup !== setup) return { ok: false, conflict: ['-y', '-n'] }
      flags.setup = setup
      continue
    }
    const cache = CACHE_FLAGS[arg]
    if (cache) {
      if (flags.cache && flags.cache !== cache) return { ok: false, conflict: ['--cache', '--no-cache'] }
      flags.cache = cache
      continue
    }
    rest.push(arg)
  }
  return { ok: true, flags, rest }
}

/**
 * The flags `central.sh up` (or the standalone `up`) should receive — ONLY what was asked for.
 *
 * An unspecified cache choice must not become `--no-cache` here: a plain `agentop central up` is
 * how a central is started, not a rebuild, and it keeps the cached build it always had. The
 * rebuild paths opt in through `rebuildFlags`.
 */
export function centralUpArgs(flags: RebuildFlags): string[] {
  const out: string[] = []
  if (flags.setup) out.push(flags.setup === 'yes' ? '--yes' : '--no')
  if (flags.cache) out.push(flags.cache === 'reuse' ? '--cache' : '--no-cache')
  return out
}

/** The same flags, read as a REBUILD: no cache unless the user explicitly asked to reuse it. */
export function rebuildFlags(flags: RebuildFlags): RebuildFlags & { cache: CacheChoice } {
  return { ...flags, cache: flags.cache ?? 'fresh' }
}

/**
 * The `docker compose` invocations that rebuild and recreate a compose service.
 *
 * `docker compose up` has no `--no-cache` — it is a `build` flag — so a cacheless rebuild is two
 * commands, and `--force-recreate` is what replaces `--build`'s recreate. Reusing the cache stays
 * the single `up -d --build` it always was.
 */
export function composeRebuildCommands(composeFile: string, flags: RebuildFlags): string[][] {
  const base = ['docker', 'compose', '-f', composeFile]
  if ((flags.cache ?? 'fresh') === 'reuse') return [[...base, 'up', '-d', '--build']]
  return [
    [...base, 'build', '--no-cache'],
    [...base, 'up', '-d', '--force-recreate'],
  ]
}
