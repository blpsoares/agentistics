/**
 * hardware-pure.ts — PURE calculations and parsers for hardware resources.
 *
 * Enforces architectural rules:
 * 1. Pure function separation (no syscalls or /proc I/O here).
 * 2. Unparseable or absent metrics yield `null` (never a fake 0).
 */

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
