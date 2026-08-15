import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import type { AppData, HarnessId } from '@agentistics/core'
import { Kpi, KpiRow, Section, Empty, DataTable, type Column } from '../components/Primitives'
import { COLORS, HARNESS_COLOR, HARNESS_LABEL } from '../theme'
import type { TuiStrings } from '../i18n'

export interface HostMetricsSnapshot {
  loadavg: number[] | null
  cpuCores: number | null
  totalMemoryBytes: number | null
  freeMemoryBytes: number | null
  usedMemoryBytes: number | null
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
  apiBase,
  s,
  width,
  height,
}: {
  data: AppData
  apiBase: string | null
  s: TuiStrings
  width: number
  height: number
}) {
  const [snapshot, setSnapshot] = useState<HardwareResourcesSnapshot | null>(null)

  useEffect(() => {
    let alive = true
    const defaultUrl = `http://localhost:${process.env.PORT || '47291'}`
    const baseUrl = (apiBase || defaultUrl).replace(/\/$/, '')

    const fetchHardware = async () => {
      try {
        let res = await fetch(`${baseUrl}/api/hardware-resources`)
        if (!res.ok && baseUrl !== defaultUrl) {
          res = await fetch(`${defaultUrl}/api/hardware-resources`)
        }
        if (res.ok) {
          const json = (await res.json()) as HardwareResourcesSnapshot
          if (alive) setSnapshot(json)
        }
      } catch {
        if (baseUrl !== defaultUrl) {
          try {
            const fallbackRes = await fetch(`${defaultUrl}/api/hardware-resources`)
            if (fallbackRes.ok && alive) {
              const json = (await fallbackRes.json()) as HardwareResourcesSnapshot
              setSnapshot(json)
            }
          } catch {
            /* fallback to N/A */
          }
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
  const diskVal =
    host?.disk?.available && host.disk.totalBytes
      ? `${fmtBytes(host.disk.usedBytes)} / ${fmtBytes(host.disk.totalBytes)}`
      : 'N/A'

  // Extract active managed sessions from AppData
  const activeSessions = ((data.sessions as unknown as SessionItem[]) ?? []).filter(
    s => s.activity && s.activity !== 'exited',
  )

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
      width: 12,
      render: r => r.activity ?? 'active',
      color: r => (r.activity === 'working' ? COLORS.success : COLORS.muted),
    },
  ]

  return (
    <Box flexDirection="column">
      {/* Host Metrics KPIs */}
      <KpiRow>
        <Kpi label={`CPU Load (${coresVal})`} value={loadVal} color={COLORS.accent} width={22} />
        <Kpi label="System RAM" value={ramVal} color={COLORS.info} width={24} />
        <Kpi label="Disk Usage (Home)" value={diskVal} color={COLORS.text} width={24} />
      </KpiRow>

      {/* Agentop Services Section */}
      <Section title="Agentop Services">
        <Box flexDirection="column" gap={0}>
          <Box flexDirection="row">
            <Box width={20}>
              <Text bold>agentop server</Text>
            </Box>
            <Box width={12}>
              <Text color={COLORS.success}>● Active</Text>
            </Box>
            <Box width={12}>
              <Text dimColor>PID {agentop?.server.pid ?? 'N/A'}</Text>
            </Box>
            <Box width={14}>
              <Text>
                CPU: <Text color={COLORS.accent}>{fmtPercent(agentop?.server.cpuPercent)}</Text>
              </Text>
            </Box>
            <Box width={18}>
              <Text>RAM: {fmtBytes(agentop?.server.rssBytes)}</Text>
            </Box>
          </Box>

          <Box flexDirection="row" marginTop={0}>
            <Box width={20}>
              <Text bold>otel-watcher</Text>
            </Box>
            <Box width={12}>
              {agentop?.otelWatcher.running ? (
                <Text color={COLORS.info}>● Running</Text>
              ) : (
                <Text dimColor>○ Off</Text>
              )}
            </Box>
            <Box width={12}>
              <Text dimColor>{agentop?.otelWatcher.pid ? `PID ${agentop.otelWatcher.pid}` : '-'}</Text>
            </Box>
            <Box width={14}>
              <Text>
                CPU: <Text color={COLORS.accent}>{fmtPercent(agentop?.otelWatcher.cpuPercent)}</Text>
              </Text>
            </Box>
            <Box width={18}>
              <Text>RAM: {fmtBytes(agentop?.otelWatcher.rssBytes)}</Text>
            </Box>
          </Box>
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
