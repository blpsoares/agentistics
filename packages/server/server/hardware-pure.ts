/**
 * hardware-pure.ts — PURE calculations and parsers for hardware resources.
 *
 * Enforces architectural rules:
 * 1. Pure function separation (no syscalls or /proc I/O here).
 * 2. Unparseable or absent metrics yield `null` (never a fake 0).
 */

/**
 * What is known about a service's process, as three answers rather than two.
 *
 * `unknown` is the one that has to exist: this machine may be unable to LOOK (no `/proc`), and
 * "nothing is running" and "I cannot tell" are different sentences — the same N/A-versus-a-
 * confident-0 rule `HARNESS_CAPABILITIES` applies to metrics and `liveEmptyNotice` to live sessions.
 */
export type ServiceRunState = 'running' | 'stopped' | 'unknown'

/** Where a running service lives: inside this very process, or as a process of its own. */
export type ServiceHosting = 'in-process' | 'separate'

/**
 * Decide the watcher's state from what could actually be observed — PURE.
 *
 * `inProcess` outranks everything: under `agentop server` the watcher is an import into the server's
 * own process (bin/cli.ts), so there is no second pid and a scan can only ever come back empty.
 * A scan that could NOT be performed yields `unknown`, never `stopped`.
 */
export function resolveServiceState(facts: {
  inProcess: boolean
  /** Whether the process list could be read at all. */
  scanned: boolean
  pid: number | null
}): { state: ServiceRunState; hosting: ServiceHosting | null } {
  if (facts.inProcess) return { state: 'running', hosting: 'in-process' }
  if (facts.pid !== null) return { state: 'running', hosting: 'separate' }
  if (!facts.scanned) return { state: 'unknown', hosting: null }
  return { state: 'stopped', hosting: null }
}

/**
 * Whether a `/proc/<pid>/cmdline` names the OTel watcher — PURE.
 *
 * The argv is NUL-separated; the caller splits it. Three shapes exist and all three are real:
 * `bun run .../otel-watcher.ts` (source), `agentop watch` (the compiled binary), and the legacy
 * `watcher.ts` path. `agentop events watch` is a DIFFERENT command (the event channel) and must not
 * match, so `watch` counts only as the command word — the argument right after the binary.
 */
export function isOtelWatcherCmdline(argv: readonly string[]): boolean {
  const args = argv.filter(Boolean)
  if (args.length === 0) return false
  if (args.some(a => a.includes('otel-watcher') || a.endsWith('/watcher.ts'))) return true
  const bin = args[0] ?? ''
  if (!/(^|\/)agentop$/.test(bin)) return false
  // `agentop watch`, and nothing that merely contains the word further along the line.
  return args[1] === 'watch'
}

export interface ProcStatSample {
  pid: number
  utime: number
  stime: number
  timestampMs: number
}

export interface DiskUsage {
  mountPath: string
  totalBytes: number | null
  usedBytes: number | null
  freeBytes: number | null
  available: boolean
}

/**
 * Parse utime and stime from /proc/<pid>/stat.
 * Field 2 is executable name in parentheses `(comm)`, which may contain spaces/parens.
 * Splitting after the LAST `)` places state at tail[0], utime at tail[11], stime at tail[12].
 */
export function parseProcStat(pid: number, rawStat: string, timestampMs: number): ProcStatSample | null {
  if (!rawStat || typeof rawStat !== 'string') return null
  const lastParen = rawStat.lastIndexOf(')')
  if (lastParen === -1) return null

  const tail = rawStat.slice(lastParen + 1).trim().split(/\s+/)
  if (tail.length < 13) return null

  const utime = Number(tail[11])
  const stime = Number(tail[12])

  if (!Number.isFinite(utime) || !Number.isFinite(stime) || utime < 0 || stime < 0) {
    return null
  }

  return { pid, utime, stime, timestampMs }
}

/**
 * Calculate CPU percentage between two process stat samples over elapsed wall time.
 * Standard Linux clock ticks per second = 100 (CLK_TCK).
 */
export function calculateProcCpu(
  prev: ProcStatSample | undefined,
  curr: ProcStatSample,
  ticksPerSec = 100,
): number | null {
  if (!prev) return null
  if (prev.pid !== curr.pid) return null

  const elapsedMs = curr.timestampMs - prev.timestampMs
  if (elapsedMs <= 0) return null

  const deltaTicks = (curr.utime + curr.stime) - (prev.utime + prev.stime)
  if (deltaTicks < 0) return null // Process restarted or counter reset

  const cpuSec = deltaTicks / ticksPerSec
  const wallSec = elapsedMs / 1000
  if (wallSec <= 0) return null

  const cpuPercent = (cpuSec / wallSec) * 100
  // Round to 1 decimal place
  return Math.round(cpuPercent * 10) / 10
}

/**
 * Parse VmRSS from /proc/<pid>/status.
 * Returns bytes or null if unparseable/absent.
 */
export function parseProcRss(rawStatus: string): number | null {
  if (!rawStatus || typeof rawStatus !== 'string') return null
  const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(rawStatus)
  if (!match || !match[1]) return null
  const kb = Number(match[1])
  if (!Number.isFinite(kb) || kb < 0) return null
  return kb * 1024
}

/**
 * Parse statfs values into DiskUsage bytes.
 */
export function parseDiskUsage(
  blocks: number,
  bavail: number,
  bsize: number,
  mountPath: string,
): DiskUsage {
  if (
    !Number.isFinite(blocks) ||
    !Number.isFinite(bavail) ||
    !Number.isFinite(bsize) ||
    blocks <= 0 ||
    bsize <= 0
  ) {
    return {
      mountPath,
      totalBytes: null,
      usedBytes: null,
      freeBytes: null,
      available: false,
    }
  }

  const totalBytes = blocks * bsize
  const freeBytes = bavail * bsize
  const usedBytes = Math.max(0, totalBytes - freeBytes)

  return {
    mountPath,
    totalBytes,
    usedBytes,
    freeBytes,
    available: true,
  }
}
