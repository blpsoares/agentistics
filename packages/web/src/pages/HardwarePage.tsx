import React, { useEffect, useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Cpu,
  HardDrive,
  Server,
  Activity,
  RefreshCw,
  Layers,
  Terminal,
  Container,
  AlertCircle,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from 'lucide-react'
import { fmt, HARNESS_ORDER, type HarnessId, type Lang } from '@agentistics/core'
import { HARNESS_LABELS } from '../lib/harness'
import { useIsMobile } from '../hooks/useIsMobile'

function NaBadge() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 6px',
        borderRadius: 4,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--text-tertiary)',
        letterSpacing: '0.03em',
      }}
    >
      N/A
    </span>
  )
}

interface DiskUsage {
  mountPath: string
  totalBytes: number | null
  usedBytes: number | null
  freeBytes: number | null
  available: boolean
}

interface HostMetrics {
  loadavg: number[] | null
  cpuCores: number | null
  totalMemoryBytes: number | null
  freeMemoryBytes: number | null
  usedMemoryBytes: number | null
  disk: DiskUsage
}

interface ProcessMetrics {
  pid: number | null
  name: string
  running: boolean
  cpuPercent: number | null
  rssBytes: number | null
}

interface ContainerMetrics {
  id: string
  name: string
  image: string
  cpuPercent: number | null
  memUsageBytes: number | null
  memLimitBytes: number | null
}

interface HardwareSnapshot {
  procAvailable: boolean
  host: HostMetrics
  agentop: {
    server: ProcessMetrics
    otelWatcher: ProcessMetrics
    dockerContainers: ContainerMetrics[]
    dockerAvailable: boolean
  }
  sampledAtMs: number
}

interface ManagedSessionView {
  id: string
  harness?: HarnessId
  label?: string
  cwd: string
  status: string
  activity?: string
  pid?: number
  cpuPercent?: number | null
  rssBytes?: number | null
}

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return 'N/A'
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const val = bytes / Math.pow(k, i)
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${sizes[i]}`
}

function fmtPercent(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return 'N/A'
  return `${val.toFixed(1)}%`
}

export function HardwarePage() {
  const context = useOutletContext<{ lang?: Lang }>()
  const lang = context?.lang ?? 'en'
  const isMobile = useIsMobile()

  const [hardware, setHardware] = useState<HardwareSnapshot | null>(null)
  const [sessions, setSessions] = useState<ManagedSessionView[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setError(null)
      const [hwRes, sessRes] = await Promise.all([
        fetch('/api/hardware-resources'),
        fetch('/api/live-sessions'),
      ])

      if (hwRes.status === 403) {
        setError(lang === 'pt' ? 'Recurso desativado pelas configurações de segurança (CAPS.localProcesses).' : 'Feature disabled by security configuration (CAPS.localProcesses).')
        setLoading(false)
        return
      }

      if (!hwRes.ok) {
        throw new Error(`HTTP ${hwRes.status}`)
      }

      const hwData = (await hwRes.json()) as HardwareSnapshot
      setHardware(hwData)

      if (sessRes.ok) {
        const sessData = await sessRes.json()
        if (sessData && Array.isArray(sessData.sessions)) {
          setSessions(sessData.sessions)
        }
      }

      setLastRefreshed(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [lang])

  useEffect(() => {
    fetchData()
    const timer = setInterval(fetchData, 5000)
    return () => clearInterval(timer)
  }, [fetchData])

  const host = hardware?.host
  const agentop = hardware?.agentop

  const ramUsedPct =
    host?.totalMemoryBytes && host.usedMemoryBytes
      ? (host.usedMemoryBytes / host.totalMemoryBytes) * 100
      : null

  const diskUsedPct =
    host?.disk?.totalBytes && host.disk.usedBytes
      ? (host.disk.usedBytes / host.disk.totalBytes) * 100
      : null

  const managedActive = sessions.filter(s => s.status !== 'exited' && s.status !== 'lost')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 16 : 24, width: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'flex-start' : 'center',
          justifyContent: 'space-between',
          gap: 12,
          paddingBottom: 12,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: isMobile ? 20 : 24,
              fontWeight: 700,
              margin: 0,
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Cpu size={24} style={{ color: 'var(--anthropic-orange)' }} />
            {lang === 'pt' ? 'Recursos de Hardware' : 'Hardware Resources'}
          </h1>
          <p
            style={{
              margin: '4px 0 0 0',
              fontSize: 13,
              color: 'var(--text-tertiary)',
            }}
          >
            {lang === 'pt'
              ? 'Uso de CPU, memória e disco pela máquina, processos do agentop e sessões gerencadas.'
              : 'Machine CPU, memory, and disk usage for agentop, background daemons, and managed sessions.'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {lastRefreshed && (
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
              {lang === 'pt' ? 'Atualizado às' : 'Updated'} {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => {
              setLoading(true)
              fetchData()
            }}
            disabled={loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              height: 44,
              padding: '0 16px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              minWidth: 44,
            }}
          >
            <RefreshCw size={15} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            {!isMobile && (lang === 'pt' ? 'Atualizar' : 'Refresh')}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#ef4444',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {hardware && !hardware.procAvailable && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            color: '#f59e0b',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <AlertCircle size={18} />
          <span>
            {lang === 'pt'
              ? 'Ambiente sem /proc detectado — leituras de processos individuais indisponíveis (degradado para N/A).'
              : 'Environment without /proc detected — per-process metrics degraded gracefully to N/A.'}
          </span>
        </div>
      )}

      {/* Host Level Section */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Server size={18} />
          {lang === 'pt' ? 'Nível do Host (Máquina)' : 'Host Level (Machine)'}
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12 }}>
          {/* CPU Load Card */}
          <div
            style={{
              padding: 16,
              borderRadius: 10,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 600 }}>
                {lang === 'pt' ? 'Carga da CPU (Load Avg)' : 'CPU Load Average'}
              </span>
              <Cpu size={16} style={{ color: 'var(--text-secondary)' }} />
            </div>

            {host?.loadavg ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {host.loadavg[0]?.toFixed(2)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    (1m) · 5m: {host.loadavg[1]?.toFixed(2)} · 15m: {host.loadavg[2]?.toFixed(2)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {host.cpuCores ? `${host.cpuCores} ${lang === 'pt' ? 'núcleos lógicos' : 'CPU cores'}` : <NaBadge />}
                </div>
              </div>
            ) : (
              <NaBadge />
            )}
          </div>

          {/* RAM Card */}
          <div
            style={{
              padding: 16,
              borderRadius: 10,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 600 }}>
                {lang === 'pt' ? 'Memória RAM' : 'System RAM'}
              </span>
              <Activity size={16} style={{ color: 'var(--text-secondary)' }} />
            </div>

            {host?.totalMemoryBytes ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtBytes(host.usedMemoryBytes)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    / {fmtBytes(host.totalMemoryBytes)}
                  </span>
                </div>
                {/* Progress bar */}
                <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, Math.max(0, ramUsedPct ?? 0))}%`,
                      background: (ramUsedPct ?? 0) > 85 ? '#ef4444' : (ramUsedPct ?? 0) > 70 ? '#f59e0b' : 'var(--anthropic-orange)',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            ) : (
              <NaBadge />
            )}
          </div>

          {/* Disk Usage Card */}
          <div
            style={{
              padding: 16,
              borderRadius: 10,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: 'var(--text-tertiary)', fontWeight: 600 }}>
                {lang === 'pt' ? 'Uso de Disco (Home)' : 'Disk Usage (Home)'}
              </span>
              <HardDrive size={16} style={{ color: 'var(--text-secondary)' }} />
            </div>

            {host?.disk?.available && host.disk.totalBytes ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtBytes(host.disk.usedBytes)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    / {fmtBytes(host.disk.totalBytes)}
                  </span>
                </div>
                {/* Progress bar */}
                <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, Math.max(0, diskUsedPct ?? 0))}%`,
                      background: (diskUsedPct ?? 0) > 90 ? '#ef4444' : (diskUsedPct ?? 0) > 75 ? '#f59e0b' : '#3b82f6',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            ) : (
              <NaBadge />
            )}
          </div>
        </div>
      </section>

      {/* Agentop Service Level Section */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Layers size={18} />
          {lang === 'pt' ? 'Processos do Agentop & Daemons' : 'Agentop Services & Daemons'}
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 12 }}>
          {/* Server process */}
          <div
            style={{
              padding: 16,
              borderRadius: 10,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Terminal size={16} style={{ color: 'var(--anthropic-orange)' }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>agentop server</span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 12,
                  background: 'rgba(34, 197, 94, 0.15)',
                  color: '#22c55e',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <CheckCircle2 size={12} />
                Active (PID {agentop?.server.pid ?? '?'})
              </span>
            </div>

            <div style={{ display: 'flex', gap: 24, fontSize: 13 }}>
              <div>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>CPU: </span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {agentop?.server.cpuPercent !== null && agentop?.server.cpuPercent !== undefined ? fmtPercent(agentop.server.cpuPercent) : <NaBadge />}
                </strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Memory (RSS): </span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {agentop?.server.rssBytes ? fmtBytes(agentop.server.rssBytes) : <NaBadge />}
                </strong>
              </div>
            </div>
          </div>

          {/* otel-watcher daemon */}
          <div
            style={{
              padding: 16,
              borderRadius: 10,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Activity size={16} style={{ color: agentop?.otelWatcher.running ? '#3b82f6' : 'var(--text-tertiary)' }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>otel-watcher daemon</span>
              </div>
              {agentop?.otelWatcher.running ? (
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: 'rgba(59, 130, 246, 0.15)',
                    color: '#3b82f6',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <CheckCircle2 size={12} />
                  Running (PID {agentop.otelWatcher.pid})
                </span>
              ) : (
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: 'var(--border)',
                    color: 'var(--text-tertiary)',
                    fontWeight: 600,
                  }}
                >
                  {lang === 'pt' ? 'Inativo' : 'Stopped / Off'}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 24, fontSize: 13 }}>
              <div>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>CPU: </span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {agentop?.otelWatcher.cpuPercent !== null && agentop?.otelWatcher.cpuPercent !== undefined ? fmtPercent(agentop.otelWatcher.cpuPercent) : <NaBadge />}
                </strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Memory (RSS): </span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {agentop?.otelWatcher.rssBytes ? fmtBytes(agentop.otelWatcher.rssBytes) : <NaBadge />}
                </strong>
              </div>
            </div>
          </div>
        </div>

        {/* Docker Containers */}
        {agentop?.dockerContainers && agentop.dockerContainers.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Container size={14} />
              {lang === 'pt' ? 'Contêineres Docker Central / Máquina' : 'Docker Containers (Central / Machine)'}
            </span>
            <div style={{ overflowX: 'auto', width: '100%', WebkitOverflowScrolling: 'touch' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13,
                  background: 'var(--bg-surface)',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                }}
              >
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-tertiary)' }}>
                    <th style={{ padding: '8px 12px' }}>Name / ID</th>
                    <th style={{ padding: '8px 12px' }}>Image</th>
                    <th style={{ padding: '8px 12px' }}>CPU%</th>
                    <th style={{ padding: '8px 12px' }}>Memory</th>
                  </tr>
                </thead>
                <tbody>
                  {agentop.dockerContainers.map(c => (
                    <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                        {c.name} <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 400 }}>({c.id.slice(0, 12)})</span>
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{c.image}</td>
                      <td style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums' }}>{fmtPercent(c.cpuPercent)}</td>
                      <td style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums' }}>{fmtBytes(c.memUsageBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Managed Sessions Section */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Terminal size={18} />
            {lang === 'pt' ? 'Sessões Gerenciadas Ativas' : 'Managed Sessions Hardware Usage'}
          </h2>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            {managedActive.length} {lang === 'pt' ? 'sessões ativas' : 'active sessions'}
          </span>
        </div>

        {managedActive.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              borderRadius: 10,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              color: 'var(--text-tertiary)',
              fontSize: 13,
            }}
          >
            {lang === 'pt' ? 'Nenhuma sessão gerenciada rodando no momento.' : 'No active managed sessions currently running.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto', width: '100%', WebkitOverflowScrolling: 'touch' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 13,
                background: 'var(--bg-surface)',
                borderRadius: 10,
                border: '1px solid var(--border)',
              }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-tertiary)' }}>
                  <th style={{ padding: '10px 14px' }}>Session / Harness</th>
                  <th style={{ padding: '10px 14px' }}>CWD</th>
                  <th style={{ padding: '10px 14px' }}>PID</th>
                  <th style={{ padding: '10px 14px' }}>CPU%</th>
                  <th style={{ padding: '10px 14px' }}>Memory (RSS)</th>
                  <th style={{ padding: '10px 14px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {managedActive.map(s => {
                  const harnessLabel = s.harness ? (HARNESS_LABELS[s.harness] ?? s.harness) : 'session'
                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            {s.label || s.id}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: 'var(--border)',
                              color: 'var(--text-secondary)',
                              width: 'fit-content',
                            }}
                          >
                            {harnessLabel}
                          </span>
                        </div>
                      </td>
                      <td
                        style={{
                          padding: '10px 14px',
                          color: 'var(--text-secondary)',
                          fontFamily: 'monospace',
                          fontSize: 12,
                          maxWidth: 220,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={s.cwd}
                      >
                        {s.cwd || 'N/A'}
                      </td>
                      <td style={{ padding: '10px 14px', fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace' }}>
                        {s.pid ? s.pid : <NaBadge />}
                      </td>
                      <td style={{ padding: '10px 14px', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {s.cpuPercent !== null && s.cpuPercent !== undefined ? fmtPercent(s.cpuPercent) : <NaBadge />}
                      </td>
                      <td style={{ padding: '10px 14px', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {s.rssBytes ? fmtBytes(s.rssBytes) : <NaBadge />}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span
                          style={{
                            fontSize: 11,
                            padding: '2px 8px',
                            borderRadius: 12,
                            background:
                              s.activity === 'working'
                                ? 'rgba(34, 197, 94, 0.15)'
                                : s.activity === 'waiting-approval'
                                ? 'rgba(245, 158, 11, 0.15)'
                                : 'var(--border)',
                            color:
                              s.activity === 'working'
                                ? '#22c55e'
                                : s.activity === 'waiting-approval'
                                ? '#f59e0b'
                                : 'var(--text-secondary)',
                            fontWeight: 600,
                          }}
                        >
                          {s.activity || s.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
