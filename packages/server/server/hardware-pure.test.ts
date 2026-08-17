import { describe, expect, test } from 'bun:test'
import {
  calculateProcCpu,
  isOtelWatcherCmdline,
  parseDiskUsage,
  parseProcRss,
  parseProcStat,
  resolveServiceState,
} from './hardware-pure'

describe('hardware-pure', () => {
  describe('parseProcStat', () => {
    test('parses standard Linux /proc/<pid>/stat with executable name containing spaces and parens', () => {
      // Field 2 is `(node (dev) app)`
      const raw = '12345 (node (dev) app) S 1 12345 12345 0 -1 4194304 100 0 0 0 150 50 0 0 20 0 1 0 1000 1000000 100'
      const parsed = parseProcStat(12345, raw, 1000)
      expect(parsed).not.toBeNull()
      expect(parsed?.pid).toBe(12345)
      expect(parsed?.utime).toBe(150)
      expect(parsed?.stime).toBe(50)
      expect(parsed?.timestampMs).toBe(1000)
    })

    test('returns null on invalid stat string or truncated input', () => {
      expect(parseProcStat(100, 'invalid string', 1000)).toBeNull()
      expect(parseProcStat(100, '100 (test) S', 1000)).toBeNull()
    })
  })

  describe('calculateProcCpu', () => {
    test('calculates correct CPU percentage over elapsed time', () => {
      const prev = { pid: 100, utime: 100, stime: 50, timestampMs: 1000 } // Total ticks = 150
      const curr = { pid: 100, utime: 200, stime: 100, timestampMs: 6000 } // Total ticks = 300, elapsed = 5000ms (5s)
      // Delta ticks = 150 ticks = 1.5 CPU seconds over 5.0 wall seconds = 30.0%
      const cpuPercent = calculateProcCpu(prev, curr, 100)
      expect(cpuPercent).toBe(30.0)
    })

    test('returns null if prev sample is missing or PIDs mismatch', () => {
      const curr = { pid: 100, utime: 200, stime: 100, timestampMs: 6000 }
      expect(calculateProcCpu(undefined, curr)).toBeNull()

      const prevDiffPid = { pid: 101, utime: 100, stime: 50, timestampMs: 1000 }
      expect(calculateProcCpu(prevDiffPid, curr)).toBeNull()
    })

    test('returns null if elapsed wall time is non-positive', () => {
      const prev = { pid: 100, utime: 100, stime: 50, timestampMs: 5000 }
      const curr = { pid: 100, utime: 150, stime: 50, timestampMs: 5000 }
      expect(calculateProcCpu(prev, curr)).toBeNull()
    })
  })

  describe('parseProcRss', () => {
    test('parses VmRSS in kB and converts to bytes', () => {
      const status = `Name:\tnode
State:\tS (sleeping)
VmSize:\t  500000 kB
VmRSS:\t   25600 kB
RssAnon:\t   20000 kB`
      const bytes = parseProcRss(status)
      expect(bytes).toBe(25600 * 1024)
    })

    test('returns null when VmRSS is absent', () => {
      expect(parseProcRss('Name:\ttest\nState:\tS')).toBeNull()
    })
  })

  describe('parseDiskUsage', () => {
    test('calculates correct total, used, free disk bytes', () => {
      // 1,000,000 blocks, 400,000 bavail, 4096 bsize
      const usage = parseDiskUsage(1_000_000, 400_000, 4096, '/home')
      expect(usage.available).toBeTrue()
      expect(usage.totalBytes).toBe(4_096_000_000)
      expect(usage.freeBytes).toBe(1_638_400_000)
      expect(usage.usedBytes).toBe(2_457_600_000)
      expect(usage.mountPath).toBe('/home')
    })

    test('degrades gracefully to nulls when statfs values are invalid', () => {
      const usage = parseDiskUsage(0, 0, 0, '/home')
      expect(usage.available).toBeFalse()
      expect(usage.totalBytes).toBeNull()
      expect(usage.usedBytes).toBeNull()
      expect(usage.freeBytes).toBeNull()
    })
  })

  describe('resolveServiceState', () => {
    test('a watcher imported into this process is running, and hosted here', () => {
      // The normal `agentop server` case: no second pid exists, and a scan can only come back empty.
      expect(resolveServiceState({ inProcess: true, scanned: true, pid: null }))
        .toEqual({ state: 'running', hosting: 'in-process' })
    })

    test('a watcher found in the process list is running as its own process', () => {
      expect(resolveServiceState({ inProcess: false, scanned: true, pid: 4242 }))
        .toEqual({ state: 'running', hosting: 'separate' })
    })

    test('a scan that could not be performed is unknown, never stopped', () => {
      expect(resolveServiceState({ inProcess: false, scanned: false, pid: null }))
        .toEqual({ state: 'unknown', hosting: null })
    })

    test('a completed scan that found nothing is a real stopped', () => {
      expect(resolveServiceState({ inProcess: false, scanned: true, pid: null }))
        .toEqual({ state: 'stopped', hosting: null })
    })
  })

  describe('isOtelWatcherCmdline', () => {
    test('matches the source daemon and the compiled binary', () => {
      expect(isOtelWatcherCmdline(['bun', 'run', '/app/packages/server/server/otel-watcher.ts'])).toBeTrue()
      expect(isOtelWatcherCmdline(['/home/u/.local/bin/agentop', 'watch'])).toBeTrue()
      expect(isOtelWatcherCmdline(['bun', 'run', '/app/packages/server/watcher.ts'])).toBeTrue()
    })

    test('never matches `agentop events watch` — a different command entirely', () => {
      expect(isOtelWatcherCmdline(['agentop', 'events', 'watch'])).toBeFalse()
    })

    test('an empty or unrelated argv is not the watcher', () => {
      expect(isOtelWatcherCmdline([])).toBeFalse()
      expect(isOtelWatcherCmdline(['', ''])).toBeFalse()
      expect(isOtelWatcherCmdline(['node', 'server.js'])).toBeFalse()
    })
  })
})
