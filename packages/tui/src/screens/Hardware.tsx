import React, { useEffect, useRef, useState } from 'react'
import { Box, Text } from 'ink'
import type { AppData, HarnessId } from '@agentistics/core'
import { Kpi, KpiRow, Section, Empty, DataTable, type Column } from '../components/Primitives'
import { COLORS, HARNESS_COLOR, HARNESS_LABEL } from '../theme'
import type { TuiStrings } from '../i18n'
import { getHardwareSnapshot } from '../../../server/server/hardware-probe'
import type { ProcStatSample } from '../../../server/server/hardware-pure'

export interface HostMetricsSnapshot {
  loadavg: number[] | null
  cpuCores: number | null
  totalMemoryBytes: number | null
  freeMemoryBytes: number | null
  usedMemoryBytes: number | null
  swapTotalBytes?: number | null
  swapUsedBytes?: number | null
  disk?: {
    totalBytes: number | null
    usedBytes: number | null
    available: boolean
  }
}

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
}

export interface HardwareResourcesSnapshot {
  procAvailable: boolean
  host: HostMetricsSnapshot
  agentop: {
    server: ProcessMetrics
    otelWatcher: ProcessMetrics
    services?: ProcessMetrics[]
    dockerContainers: ContainerMetrics[]
  }
}

export interface SessionItem {
  id: string
  label?: string
  harness?: HarnessId
  pid?: number
  cpuPercent?: number | null
  rssBytes?: number | null
  activity?: string
}

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return 'N/A'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function fmtPercent(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return 'N/A'
  return `${val.toFixed(1)}%`
}

export function Hardware({
  data,
  fleetSessions,
  apiBase,
  s,
  width,
  height,
}: {
  data: AppData
  fleetSessions?: any[]
  apiBase: string | null
  s: TuiStrings
  width: number
  height: number
}) {
  const [snapshot, setSnapshot] = useState<HardwareResourcesSnapshot | null>(null)

  const statsMapRef = useRef<Map<number, ProcStatSample>>(new Map())

  useEffect(() => {
    let alive = true
    const defaultUrl = `http://localhost:${process.env.PORT || '47291'}`
    const baseUrl = (apiBase || defaultUrl).replace(/\/$/, '')

    const fetchHardware = async () => {
      let fetched = false
      try {
        let res = await fetch(`${baseUrl}/api/hardware-resources`)
        if (!res.ok && baseUrl !== defaultUrl) {
          res = await fetch(`${defaultUrl}/api/hardware-resources`)
        }
        if (res.ok) {
          const json = (await res.json()) as HardwareResourcesSnapshot
          if (alive) {
            setSnapshot(json)
            fetched = true
          }
        }
      } catch {
        /* HTTP fetch failed, fallback to direct local probe */
      }

      if (!fetched && alive) {
        try {
          const directSnap = await getHardwareSnapshot(statsMapRef.current)
          if (alive) setSnapshot(directSnap)
        } catch {
          /* ignore */
        }
      }
    }
    void fetchHardware()
    const timer = setInterval(fetchHardware, 3000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [apiBase])

  const host = snapshot?.host
  const agentop = snapshot?.agentop

  const loadVal = host?.loadavg ? `${host.loadavg[0]?.toFixed(2)} (1m)` : 'N/A'
  const coresVal = host?.cpuCores ? `${host.cpuCores} cores` : 'N/A'
  const ramVal = host?.totalMemoryBytes
    ? `${fmtBytes(host.usedMemoryBytes)} / ${fmtBytes(host.totalMemoryBytes)}`
    : 'N/A'
  const swapVal =
    host?.swapTotalBytes && host.swapTotalBytes > 0
      ? `${fmtBytes(host.swapUsedBytes ?? 0)} / ${fmtBytes(host.swapTotalBytes)}`
      : 'N/A'
  const diskVal =
    host?.disk?.available && host.disk.totalBytes
      ? `${fmtBytes(host.disk.usedBytes)} / ${fmtBytes(host.disk.totalBytes)}`
      : 'N/A'

  // Extract active managed sessions from fleetSessions or AppData
  const activeFleetSessions: SessionItem[] = (fleetSessions ?? [])
    .filter(s => s.state !== 'closed' && s.state !== 'exited' && s.state !== 'lost' && s.state !== 'unknown')
    .map(s => ({
      id: s.id,
      label: s.title || s.id,
      harness: s.harness as HarnessId,
      pid: s.pid,
      activity: s.stateLabel || s.state,
      cpuPercent: s.cpuPercent ?? null,
      rssBytes: s.rssBytes ?? null,
    }))

  const activeAppDataSessions = ((data.sessions as unknown as SessionItem[]) ?? []).filter(
    s => s.activity && s.activity !== 'exited' && s.activity !== 'closed',
  )

  const activeSessions = fleetSessions ? activeFleetSessions : activeAppDataSessions

  const columns: Column<SessionItem>[] = [
    {
      key: 'label',
      header: 'Session',
      width: 22,
      render: r => r.label || r.id.slice(0, 8),
      color: () => COLORS.text,
    },
    {
      key: 'harness',
      header: 'Harness',
      width: 12,
      render: r => {
        const h = r.harness as HarnessId | undefined
        return h ? HARNESS_LABEL[h] ?? String(h) : 'N/A'
      },
      color: r => {
        const h = r.harness as HarnessId | undefined
        return h ? HARNESS_COLOR[h] : undefined
      },
    },
    {
      key: 'pid',
      header: 'PID',
      width: 8,
      render: r => (r.pid ? String(r.pid) : 'N/A'),
    },
    {
      key: 'cpu',
      header: 'CPU%',
      width: 9,
      align: 'right',
      render: r => fmtPercent(r.cpuPercent),
      color: () => COLORS.accent,
    },
    {
      key: 'rss',
      header: 'RAM (RSS)',
      width: 12,
      align: 'right',
      render: r => fmtBytes(r.rssBytes),
    },
    {
      key: 'status',
      header: 'Status',
      width: 14,
      render: r => r.activity ?? 'active',
      color: r => {
        const act = (r.activity ?? '').toLowerCase()
        if (act.includes('trabalhando') || act.includes('working') || act.includes('active') || act.includes('running')) {
          return COLORS.success
        }
        if (act.includes('aguardando') || act.includes('waiting') || act.includes('approval')) {
          return COLORS.accent
        }
        if (act.includes('desligada') || act.includes('closed') || act.includes('exited') || act.includes('off')) {
          return COLORS.muted
        }
        return COLORS.info
      },
    },
  ]

  // Active services to display (only services that are actually running)
  const activeServices: ProcessMetrics[] = agentop?.services?.filter((s: ProcessMetrics) => s.running) ?? [
    ...(agentop?.server ? [agentop.server] : []),
    ...(agentop?.otelWatcher?.running ? [agentop.otelWatcher] : []),
  ]

  const activeContainers = agentop?.dockerContainers ?? []

  return (
    <Box flexDirection="column">
      {/* Host Metrics KPIs */}
      <KpiRow>
        <Kpi label={`WSL CPU (${coresVal})`} value={loadVal} color={COLORS.accent} width={22} />
        <Kpi label="WSL RAM (Apps)" value={ramVal} color={COLORS.info} width={24} />
        <Kpi label="Swap (Virtual)" value={swapVal} color={COLORS.muted} width={22} />
        <Kpi label="Disk (/home VHDX)" value={diskVal} color={COLORS.text} width={22} />
      </KpiRow>

      {/* Agentop Services Section (Only Running Services) */}
      <Section title="Agentop Services">
        <Box flexDirection="column" gap={0}>
          {activeServices.map((svc: ProcessMetrics) => (
            <Box key={svc.name} flexDirection="row">
              <Box width={20}>
                <Text bold>{svc.name}</Text>
              </Box>
              <Box width={12}>
                <Text color={COLORS.success}>● Active</Text>
              </Box>
              <Box width={12}>
                <Text dimColor>{svc.pid ? `PID ${svc.pid}` : '-'}</Text>
              </Box>
              <Box width={14}>
                <Text>
                  CPU: <Text color={COLORS.accent}>{fmtPercent(svc.cpuPercent)}</Text>
                </Text>
              </Box>
              <Box width={18}>
                <Text>RAM: {fmtBytes(svc.rssBytes)}</Text>
              </Box>
            </Box>
          ))}

          {activeContainers.map(c => (
            <Box key={c.id} flexDirection="row">
              <Box width={20}>
                <Text bold>{c.name}</Text>
              </Box>
              <Box width={12}>
                <Text color={COLORS.info}>● Docker</Text>
              </Box>
              <Box width={12}>
                <Text dimColor>{c.id.slice(0, 8)}</Text>
              </Box>
              <Box width={14}>
                <Text>
                  CPU: <Text color={COLORS.accent}>{fmtPercent(c.cpuPercent)}</Text>
                </Text>
              </Box>
              <Box width={18}>
                <Text>RAM: {fmtBytes(c.memUsageBytes)}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      </Section>

      {/* Managed Sessions Hardware Table */}
      <Section title={`Managed Active Sessions (${activeSessions.length})`}>
        {activeSessions.length === 0 ? (
          <Empty message="No active managed sessions currently running." />
        ) : (
          <DataTable columns={columns} rows={activeSessions} keyOf={r => r.id} width={width} />
        )}
      </Section>
    </Box>
  )
}
