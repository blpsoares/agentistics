/**
 * hardware-probe.ts — the impure I/O layer for reading machine hardware resources.
 *
 * Reads:
 * 1. Host level metrics: CPU loadavg, total/used RAM, disk usage of HOME_DIR.
 * 2. Agentop process metrics: server process (process.pid), otel-watcher daemon, Docker containers.
 * 3. Degrades to `null` or N/A on non-Linux or unreadable metrics.
 */

import { readFile, statfs } from 'node:fs/promises'
import { loadavg, totalmem, freemem, cpus } from 'node:os'
import { HOME_DIR } from './config'
import {
  calculateProcCpu,
  parseDiskUsage,
  parseProcRss,
  parseProcStat,
  type DiskUsage,
  type ProcStatSample,
} from './hardware-pure'
import { procAvailable } from './sessions/proc-liveness'

export interface ProcessMetrics {
  pid: number | null
  name: string
  running: boolean
  cpuPercent: number | null
  rssBytes: number | null
}

export interface ContainerMetrics {
  id: string
  name: string
  image: string
  cpuPercent: number | null
  memUsageBytes: number | null
  memLimitBytes: number | null
}

export interface HostMetricsSnapshot {
  loadavg: number[] | null
  cpuCores: number | null
  totalMemoryBytes: number | null
  freeMemoryBytes: number | null
  usedMemoryBytes: number | null
  disk: DiskUsage
}

export interface AgentopMetricsSnapshot {
  server: ProcessMetrics
  otelWatcher: ProcessMetrics
  dockerContainers: ContainerMetrics[]
  dockerAvailable: boolean
}

export interface HardwareResourcesSnapshot {
  procAvailable: boolean
  host: HostMetricsSnapshot
  agentop: AgentopMetricsSnapshot
  sampledAtMs: number
}

/** Read raw /proc/<pid>/stat and parse it into a sample. */
export async function readProcStat(pid: number, timestampMs = Date.now()): Promise<ProcStatSample | null> {
  try {
    const raw = await readFile(`/proc/${pid}/stat`, 'utf8')
    return parseProcStat(pid, raw, timestampMs)
  } catch {
    return null
  }
}

/** Read raw /proc/<pid>/status VmRSS. */
export async function readProcRss(pid: number): Promise<number | null> {
  try {
    const raw = await readFile(`/proc/${pid}/status`, 'utf8')
    return parseProcRss(raw)
  } catch {
    return null
  }
}

/** Read disk usage via statfs on target path (defaulting to HOME_DIR). */
export async function readDiskMetrics(path = HOME_DIR): Promise<DiskUsage> {
  try {
    const stats = await statfs(path)
    return parseDiskUsage(stats.blocks, stats.bavail, stats.bsize, path)
  } catch {
    return {
      mountPath: path,
      totalBytes: null,
      usedBytes: null,
      freeBytes: null,
      available: false,
    }
  }
}

/** Read host CPU load, RAM, and Disk metrics. */
export async function readHostMetrics(): Promise<HostMetricsSnapshot> {
  const disk = await readDiskMetrics()
  try {
    const loads = loadavg()
    const total = totalmem()
    const free = freemem()
    const cores = cpus()?.length ?? null

    const validLoads = loads && loads.length === 3 && loads.every(Number.isFinite) ? loads : null
    const validTotal = Number.isFinite(total) && total > 0 ? total : null
    const validFree = Number.isFinite(free) && free >= 0 ? free : null
    const validUsed = validTotal !== null && validFree !== null ? Math.max(0, validTotal - validFree) : null

    return {
      loadavg: validLoads,
      cpuCores: Number.isFinite(cores) && cores! > 0 ? cores : null,
      totalMemoryBytes: validTotal,
      freeMemoryBytes: validFree,
      usedMemoryBytes: validUsed,
      disk,
    }
  } catch {
    return {
      loadavg: null,
      cpuCores: null,
      totalMemoryBytes: null,
      freeMemoryBytes: null,
      usedMemoryBytes: null,
      disk,
    }
  }
}

/**
 * Scan for otel-watcher daemon process PID if running.
 */
async function findOtelWatcherPid(serverPid: number): Promise<number | null> {
  // If OTEL exporter isn't configured or we're on a non-Linux system, otel-watcher isn't running
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return null
  try {
    const { readdir } = await import('node:fs/promises')
    const pids = await readdir('/proc')
    for (const p of pids) {
      if (!/^\d+$/.test(p)) continue
      const pid = Number(p)
      if (pid === serverPid) continue
      try {
        const cmdline = await readFile(`/proc/${pid}/cmdline`, 'utf8')
        if (cmdline.includes('watcher.ts') || cmdline.includes('otel-watcher')) {
          return pid
        }
      } catch { /* process gone or unreadable */ }
    }
  } catch { /* no /proc */ }
  return null
}

const CENTRAL_FILTER = 'label=com.docker.compose.project=team-mode'
const MACHINE_FILTER = 'ancestor=agentistics-machine'

/** Read Docker container metrics for agentistics central/machine containers. */
async function readDockerMetrics(): Promise<{ containers: ContainerMetrics[]; available: boolean }> {
  try {
    const proc = Bun.spawn(
      ['docker', 'ps', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}', '-f', CENTRAL_FILTER, '-f', MACHINE_FILTER],
      { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' },
    )
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      return { containers: [], available: false }
    }
    const stdout = await new Response(proc.stdout).text()
    const lines = stdout.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) {
      return { containers: [], available: true }
    }

    // Try `docker stats --no-stream` for live container CPU & RAM
    const statsProc = Bun.spawn(
      ['docker', 'stats', '--no-stream', '--format', '{{.ID}}\t{{.CPUPerc}}\t{{.MemUsage}}'],
      { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' },
    )
    const statsOut = (await statsProc.exited) === 0 ? await new Response(statsProc.stdout).text() : ''
    const statsMap = new Map<string, { cpuPercent: number | null; memUsageBytes: number | null; memLimitBytes: number | null }>()

    for (const rawLine of statsOut.split('\n')) {
      const line = rawLine.trim()
      if (!line) continue
      const [id, cpuStr, memStr] = line.split('\t')
      if (!id) continue

      let cpuPercent: number | null = null
      if (cpuStr && cpuStr.endsWith('%')) {
        const val = Number(cpuStr.slice(0, -1))
        if (Number.isFinite(val)) cpuPercent = val
      }

      let memUsageBytes: number | null = null
      let memLimitBytes: number | null = null
      if (memStr && memStr.includes('/')) {
        const [usagePart, limitStr] = memStr.split('/').map(s => s.trim())
        memUsageBytes = parseDockerBytes(usagePart)
        memLimitBytes = parseDockerBytes(limitStr)
      }

      statsMap.set(id, { cpuPercent, memUsageBytes, memLimitBytes })
    }

    const containers: ContainerMetrics[] = lines.map(line => {
      const [id, name, image] = line.split('\t')
      const stats = statsMap.get(id ?? '') ?? { cpuPercent: null, memUsageBytes: null, memLimitBytes: null }
      return {
        id: id ?? '',
        name: name ?? 'docker-container',
        image: image ?? '',
        cpuPercent: stats.cpuPercent,
        memUsageBytes: stats.memUsageBytes,
        memLimitBytes: stats.memLimitBytes,
      }
    })

    return { containers, available: true }
  } catch {
    return { containers: [], available: false }
  }
}

/** Helper to parse docker stats human memory strings e.g. "120.5MiB", "1.2GiB", "500kB". */
function parseDockerBytes(str: string | undefined): number | null {
  if (!str) return null
  const m = /^([\d.]+)\s*([A-Za-z]+)?$/.exec(str.trim())
  if (!m || !m[1]) return null
  const num = Number(m[1])
  if (!Number.isFinite(num)) return null
  const unit = (m[2] ?? '').toLowerCase()
  if (unit.startsWith('gi') || unit === 'gb' || unit === 'g') return Math.round(num * 1024 * 1024 * 1024)
  if (unit.startsWith('mi') || unit === 'mb' || unit === 'm') return Math.round(num * 1024 * 1024)
  if (unit.startsWith('ki') || unit === 'kb' || unit === 'k') return Math.round(num * 1024)
  if (unit === 'b' || !unit) return Math.round(num)
  return Math.round(num)
}

/**
 * Sample agentop's own process metrics (server, watcher, docker containers).
 */
export async function readAgentopMetrics(
  prevStatsMap: Map<number, ProcStatSample>,
  timestampMs = Date.now(),
): Promise<AgentopMetricsSnapshot> {
  const serverPid = process.pid
  const serverStat = await readProcStat(serverPid, timestampMs)
  const serverRss = await readProcRss(serverPid)

  let serverCpuPercent: number | null = null
  if (serverStat) {
    const prevServer = prevStatsMap.get(serverPid)
    serverCpuPercent = calculateProcCpu(prevServer, serverStat)
    prevStatsMap.set(serverPid, serverStat)
  }

  const watcherPid = await findOtelWatcherPid(serverPid)
  let watcherCpuPercent: number | null = null
  let watcherRss: number | null = null

  if (watcherPid !== null) {
    const watcherStat = await readProcStat(watcherPid, timestampMs)
    watcherRss = await readProcRss(watcherPid)
    if (watcherStat) {
      const prevWatcher = prevStatsMap.get(watcherPid)
      watcherCpuPercent = calculateProcCpu(prevWatcher, watcherStat)
      prevStatsMap.set(watcherPid, watcherStat)
    }
  }

  const { containers, available: dockerAvailable } = await readDockerMetrics()

  return {
    server: {
      pid: serverPid,
      name: 'agentop server',
      running: true,
      cpuPercent: serverCpuPercent,
      rssBytes: serverRss,
    },
    otelWatcher: {
      pid: watcherPid,
      name: 'otel-watcher',
      running: watcherPid !== null,
      cpuPercent: watcherCpuPercent,
      rssBytes: watcherRss,
    },
    dockerContainers: containers,
    dockerAvailable,
  }
}

/** Collect full hardware resources snapshot. */
export async function getHardwareSnapshot(
  prevStatsMap: Map<number, ProcStatSample>,
): Promise<HardwareResourcesSnapshot> {
  const canReadProc = await procAvailable()
  const sampledAtMs = Date.now()

  const host = await readHostMetrics()
  const agentop = canReadProc
    ? await readAgentopMetrics(prevStatsMap, sampledAtMs)
    : {
        server: { pid: process.pid, name: 'agentop server', running: true, cpuPercent: null, rssBytes: null },
        otelWatcher: { pid: null, name: 'otel-watcher', running: false, cpuPercent: null, rssBytes: null },
        dockerContainers: [],
        dockerAvailable: false,
      }

  return {
    procAvailable: canReadProc,
    host,
    agentop,
    sampledAtMs,
  }
}
