/**
 * central-runtime.ts — PURE: the ways a central can be brought up, and which of them work HERE.
 *
 * There are three, and they are genuinely different products of the same code:
 *
 *   docker-build   build the image from this checkout and run it in Docker (central.sh's path)
 *   docker-image   pull the published image and run it in Docker — no checkout needed
 *   native         the agentop binary IS the server; no Docker, no container
 *
 * The question used to be answered by inference alone: `planCentralStart` looked at what was on
 * disk and picked one, so a user who had cloned the repo could not ask for the published image,
 * and a user who wanted to see the options had nowhere to look. The choice is now the user's, and
 * this module is what both surfaces ask — `agentop central up --image|--build|--native` and the
 * control center's start verbs — so the CLI and the cockpit cannot offer different answers.
 *
 * Two rules are load-bearing:
 *
 *  • A runtime that cannot work HERE is UNAVAILABLE, with a reason. `docker-build` needs a
 *    checkout, `native` needs a database it can actually reach. Offering a verb that fails on
 *    principle is worse than not offering it — the same rule the cockpit applies to a rebuild it
 *    cannot perform — but a blocked option that says nothing is indistinguishable from a broken
 *    one, so the reason travels with it and the surface states it in words.
 *  • Reasons are CODES, never sentences. This module is language-free; `cli-i18n.ts` and the
 *    control center's own strings render them, exactly as `LiveUnavailableReason` is rendered by
 *    `liveEmptyNotice` rather than carrying English into the model.
 */

/** One concrete way to bring a central up. */
export type CentralRuntimeId = 'docker-build' | 'docker-image' | 'native'

/** Stable order for every surface that lists them: cheapest-to-reach first. */
export const CENTRAL_RUNTIMES: readonly CentralRuntimeId[] = ['docker-image', 'docker-build', 'native']

/**
 * Why a runtime cannot run here.
 *
 * `no-env` is not the same as `bundled-mongo` and must not be collapsed into it: one says the
 * central has not been configured yet (so the answer is unknown and `init` is the next step), the
 * other says it HAS been configured, for a database only Docker can reach. Telling someone their
 * database is wrong when they simply have not set one up sends them to the wrong screen.
 */
export type CentralRuntimeBlock = 'no-docker' | 'no-checkout' | 'no-env' | 'bundled-mongo'

/** What this box can tell us. Every field is something only the caller can look up. */
export interface CentralRuntimeFacts {
  /** A `central.sh` was found — i.e. this is a repository checkout. */
  script: boolean
  /** The `docker` CLI is on PATH. */
  docker: boolean
  /** The central's env file (`central.env`) exists. */
  envFile: boolean
  /** Its `MONGO_URL`, or `''` when there is no env file / no such key. */
  mongoUrl: string
}

/** A runtime as offered (or withheld) on this box. */
export interface CentralRuntimeOption {
  id: CentralRuntimeId
  available: boolean
  /** Present exactly when `available` is false. */
  reason?: CentralRuntimeBlock
}

/**
 * True when `MONGO_URL` targets the bundled Docker `mongo` service, as opposed to an external
 * cluster (Atlas, a Mongo you run yourself).
 *
 * Duplicated from `cli-central.ts` deliberately: this module must stay importable without dragging
 * in the filesystem-touching central handler, which is what lets the control center's pure layer
 * and the tests read it. `central-runtime.test.ts` cross-checks the two against the same inputs, so
 * they cannot drift into disagreeing about which side of the line a URL falls on.
 */
export function targetsBundledMongo(mongoUrl: string): boolean {
  return /(?:\/\/|@)mongo:\d+/.test(mongoUrl)
}

/**
 * Every runtime, in `CENTRAL_RUNTIMES` order, each with whether it works here and why not.
 *
 * Nothing is filtered out: a surface that wants only the usable ones filters, and a surface that
 * wants to EXPLAIN the missing ones (the cockpit's detail pane, `agentop central up`'s picker)
 * has the reasons without asking a second question.
 */
export function centralRuntimeOptions(facts: CentralRuntimeFacts): CentralRuntimeOption[] {
  return CENTRAL_RUNTIMES.map(id => {
    const reason = blockFor(id, facts)
    return reason ? { id, available: false, reason } : { id, available: true }
  })
}

/** Why `id` cannot run here, or null when it can. */
function blockFor(id: CentralRuntimeId, facts: CentralRuntimeFacts): CentralRuntimeBlock | null {
  switch (id) {
    case 'docker-image':
      return facts.docker ? null : 'no-docker'
    case 'docker-build':
      // Checkout first: without one there is nothing to build, and saying "install docker" to
      // someone holding only the binary sends them to install a tool that still would not help.
      if (!facts.script) return 'no-checkout'
      return facts.docker ? null : 'no-docker'
    case 'native':
      if (!facts.envFile) return 'no-env'
      return targetsBundledMongo(facts.mongoUrl) || facts.mongoUrl === '' ? 'bundled-mongo' : null
  }
}

/** The usable ones, in order. */
export function availableCentralRuntimes(facts: CentralRuntimeFacts): CentralRuntimeId[] {
  return centralRuntimeOptions(facts).filter(o => o.available).map(o => o.id)
}

/**
 * What `agentop central up` does when the user has not said — today's behaviour, stated.
 *
 * A checkout wins over the published image because that is what `central.sh` has always done and
 * what someone standing in the repo means by "up"; without one, the database decides, exactly as
 * `planCentralStart` decided before this module existed. Returns null only when nothing here can
 * run a central at all (no docker and no external database), which is a refusal the caller states.
 */
export function defaultCentralRuntime(facts: CentralRuntimeFacts): CentralRuntimeId | null {
  const available = availableCentralRuntimes(facts)
  if (available.length === 0) return null
  if (available.includes('docker-build')) return 'docker-build'
  // An external database is a deliberate choice that Docker cannot serve locally, so it outranks
  // pulling an image that would then start a Mongo nobody asked for.
  if (available.includes('native')) return 'native'
  return available.includes('docker-image') ? 'docker-image' : available[0]!
}

export type CentralRuntimeResolution =
  | { ok: true; id: CentralRuntimeId; chosen: boolean }
  | { ok: false; id: CentralRuntimeId | null; reason: CentralRuntimeBlock | 'none-available' }

/**
 * Settle the runtime: what the user asked for when they asked, the default otherwise.
 *
 * A REQUESTED runtime that cannot run here is refused rather than silently downgraded. Falling
 * back would be the worst outcome available: `--native` quietly becoming a Docker start is a
 * central running under a shape its operator did not choose, on a box they believed had no Docker
 * involvement, and nothing on screen would say so.
 *
 * `chosen` records whether the answer came from the user, so a caller can tell the difference
 * between "you asked for this" and "this is what I picked" when it reports what it is about to do.
 */
export function resolveCentralRuntime(
  requested: CentralRuntimeId | undefined,
  facts: CentralRuntimeFacts,
): CentralRuntimeResolution {
  if (requested) {
    const reason = blockFor(requested, facts)
    return reason ? { ok: false, id: requested, reason } : { ok: true, id: requested, chosen: true }
  }
  const fallback = defaultCentralRuntime(facts)
  return fallback
    ? { ok: true, id: fallback, chosen: false }
    : { ok: false, id: null, reason: 'none-available' }
}

// ---------------------------------------------------------------------------
// The flags
// ---------------------------------------------------------------------------

const RUNTIME_FLAGS: Record<string, CentralRuntimeId> = {
  '--image': 'docker-image',
  '--docker-image': 'docker-image',
  '--build': 'docker-build',
  '--docker-build': 'docker-build',
  '--native': 'native',
}

/** How a native central holds the terminal: attached, or detached and left running. */
export type CentralStartHow = 'fg' | 'bg'

const HOW_FLAGS: Record<string, CentralStartHow> = {
  '--bg': 'bg',
  '--detach': 'bg',
  '-d': 'bg',
  '--fg': 'fg',
  '--foreground': 'fg',
}

export interface CentralUpFlags {
  runtime?: CentralRuntimeId
  how?: CentralStartHow
}

export type CentralUpFlagsResult =
  | { ok: true; flags: CentralUpFlags; rest: string[] }
  | { ok: false; conflict: readonly [string, string] }

/**
 * Read the runtime flags out of an argv, leaving everything else in `rest` for
 * `parseRebuildFlags` to take its own share of.
 *
 * Repeating one spelling of the same answer is fine; asking for two different runtimes is refused
 * rather than resolved, for the same reason `parseRebuildFlags` refuses `-y -n`: either choice
 * would be a guess, and one of them starts a container the user did not want.
 */
export function parseCentralUpFlags(argv: readonly string[]): CentralUpFlagsResult {
  const flags: CentralUpFlags = {}
  const rest: string[] = []
  for (const arg of argv) {
    const runtime = RUNTIME_FLAGS[arg]
    if (runtime) {
      if (flags.runtime && flags.runtime !== runtime) {
        return { ok: false, conflict: [flagFor(flags.runtime), arg] }
      }
      flags.runtime = runtime
      continue
    }
    const how = HOW_FLAGS[arg]
    if (how) {
      if (flags.how && flags.how !== how) return { ok: false, conflict: ['--fg', '--bg'] }
      flags.how = how
      continue
    }
    rest.push(arg)
  }
  return { ok: true, flags, rest }
}

/** The canonical spelling of a runtime flag, for an error message about the one already given. */
export function flagFor(id: CentralRuntimeId): string {
  switch (id) {
    case 'docker-image': return '--image'
    case 'docker-build': return '--build'
    case 'native': return '--native'
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * The key `central.env` carries the choice under.
 *
 * It lives in central.env because that is the central's config file and the one thing every path
 * already reads — but it is read by the CLI ONLY and is deliberately not passed into the
 * container by any compose file: the server has no use for it, and an env var the app ignores
 * appearing in its environment is a thing someone will later try to make mean something.
 */
export const RUNTIME_ENV_KEY = 'AGENTISTICS_CENTRAL_RUNTIME'

/** Parse a stored value. Anything unrecognised is `undefined` — a hand-edited typo falls back to
 *  the default rather than refusing to start a central over a spelling. */
export function parseStoredRuntime(raw: string | undefined): CentralRuntimeId | undefined {
  const v = (raw ?? '').trim()
  return (CENTRAL_RUNTIMES as readonly string[]).includes(v) ? (v as CentralRuntimeId) : undefined
}
