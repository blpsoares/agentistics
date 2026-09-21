/**
 * hardwarePressure.ts — PURE: is this machine's hardware under enough pressure that the rail's own
 * Hardware icon (addendum item 6, right-icon-rail spec) and a notification should say so.
 *
 * THREE MEASURES, each its own named threshold WITH A REASON, read SEPARATELY rather than blended
 * into one score — a reader who sees red wants to know WHICH resource to go look at, and averaging
 * RAM at 40% with disk at 95% into "67%" would hide the one number that actually matters.
 *
 * "UNMEASURED" IS HONEST, NEVER A SILENT PASS: a host with no `/proc`, or a probe that has not
 * sampled yet, reports every field `null` — and a pressure check that read `null` as "0%, no
 * pressure" would tell a reader running hot that everything is fine because nobody could check.
 * `resourcesPressure` returns only what it could actually measure; an EMPTY result means "nothing
 * could be checked here", never "nothing is under pressure" — the same N/A-vs-a-confident-0 rule
 * `HARNESS_CAPABILITIES` applies to a metric, applied here to a reading.
 */

/** RAM, in percent used. Matches `HardwareModal.tsx`'s own bar colours (`ramUsedPct`) — this is now
 *  the single source both read, so the modal and the rail's red icon can never disagree about where
 *  the line is for the same number. */
export const RAM_WARN_PCT = 70
/** Past this, the machine is a bad place to start another heavy session — reserve headroom for the
 *  OS's own page cache and a browser tab or two, not just the assistant processes themselves. */
export const RAM_CRITICAL_PCT = 85

/** Matches `HardwareModal.tsx`'s own disk bar colours (`diskUsedPct`). */
export const DISK_WARN_PCT = 75
/** Higher margin than RAM's: disk fills far more slowly, so a false alarm here costs a reader more
 *  (there is no quick "close a tab" for disk) — but past this line a build, a `git clone` or a log
 *  file can turn "almost full" into a write failure within one session. */
export const DISK_CRITICAL_PCT = 90

/** The host reports no instantaneous CPU percent of its own (only individual PROCESSES carry one —
 *  see `ProcessMetrics.cpuPercent` in `HardwareModal.tsx`), so `loadavg[0] / cpuCores` is the proxy:
 *  a ratio past 1.0 means more runnable processes than cores, i.e. something is queued waiting for
 *  CPU. 1.5 gives a short burst room to clear on its own before this counts it as pressure — the
 *  same margin `pressureTransition`'s own transition-only rule protects against for a metric that
 *  spikes for a few seconds and settles. */
export const CPU_LOAD_WARN_RATIO = 1.0
export const CPU_LOAD_CRITICAL_RATIO = 1.5

export type PressureResource = 'ram' | 'disk' | 'cpu'
export type PressureLevel = 'ok' | 'warn' | 'critical'

export interface ResourcePressure {
  resource: PressureResource
  /** 0-100-ish. For `cpu` this is the load RATIO times 100, so `150` reads as "1.5× the core
   *  count" — never a percent of anything, but kept on the same scale so sorting "worst first"
   *  across resources needs no per-resource special case. */
  pct: number
  level: PressureLevel
}

function levelOf(value: number, warn: number, critical: number): PressureLevel {
  return value >= critical ? 'critical' : value >= warn ? 'warn' : 'ok'
}

/** `null` when either figure is missing or the total is nonsensical — never a divide that yields
 *  `Infinity` or `NaN` read as a level. */
export function ramPressure(usedBytes: number | null, totalBytes: number | null): ResourcePressure | null {
  if (usedBytes === null || totalBytes === null || totalBytes <= 0) return null
  const pct = (usedBytes / totalBytes) * 100
  return { resource: 'ram', pct, level: levelOf(pct, RAM_WARN_PCT, RAM_CRITICAL_PCT) }
}

/** `available` mirrors `DiskUsage.available` (`HardwareModal.tsx`) — a mount this host could not
 *  read is unmeasured, not a disk reading of zero. */
export function diskPressure(
  usedBytes: number | null, totalBytes: number | null, available: boolean,
): ResourcePressure | null {
  if (!available || usedBytes === null || totalBytes === null || totalBytes <= 0) return null
  const pct = (usedBytes / totalBytes) * 100
  return { resource: 'disk', pct, level: levelOf(pct, DISK_WARN_PCT, DISK_CRITICAL_PCT) }
}

export function cpuPressure(loadavg1: number | null, cpuCores: number | null): ResourcePressure | null {
  if (loadavg1 === null || cpuCores === null || cpuCores <= 0) return null
  const ratio = loadavg1 / cpuCores
  return { resource: 'cpu', pct: ratio * 100, level: levelOf(ratio, CPU_LOAD_WARN_RATIO, CPU_LOAD_CRITICAL_RATIO) }
}

export interface HardwarePressureInput {
  host: {
    usedMemoryBytes: number | null
    totalMemoryBytes: number | null
    disk: { usedBytes: number | null; totalBytes: number | null; available: boolean }
    loadavg: number[] | null
    cpuCores: number | null
  }
}

/** Every measurable resource's pressure — omits whatever could not be measured, in the fixed order
 *  ram/disk/cpu. Never invents a reading; see this module's own header. */
export function resourcesPressure(input: HardwarePressureInput): readonly ResourcePressure[] {
  const out: ResourcePressure[] = []
  const ram = ramPressure(input.host.usedMemoryBytes, input.host.totalMemoryBytes)
  if (ram) out.push(ram)
  const disk = diskPressure(input.host.disk.usedBytes, input.host.disk.totalBytes, input.host.disk.available)
  if (disk) out.push(disk)
  const cpu = cpuPressure(input.host.loadavg?.[0] ?? null, input.host.cpuCores)
  if (cpu) out.push(cpu)
  return out
}

/** Is ANY measured resource at `critical`? `false` on an empty (nothing-measurable) list — the rail
 *  draws no red for a machine it cannot read, the same rule `resourcesPressure` states for itself. */
export function anyCritical(pressures: readonly ResourcePressure[]): boolean {
  return pressures.some(p => p.level === 'critical')
}

/**
 * TRANSITION-ONLY (the addendum's own requirement): fires exactly once per crossing INTO critical,
 * never on every poll while it stays there and never on the way back down. `prevCritical === null`
 * means "no prior reading exists yet" (the first sample after mount, or after a gap where hardware
 * could not be read at all) and NEVER fires — there is nothing to have transitioned FROM, and firing
 * on an assumed `false` would announce "pressure" the instant a machine that was always hot first
 * became readable.
 */
export function pressureTransition(prevCritical: boolean | null, nextCritical: boolean): boolean {
  return prevCritical === false && nextCritical === true
}

const RESOURCE_LABEL: Record<PressureResource, { pt: string; en: string }> = {
  ram: { pt: 'memória RAM', en: 'RAM' },
  disk: { pt: 'disco', en: 'disk' },
  cpu: { pt: 'CPU', en: 'CPU' },
}

/**
 * The recommendation — NAMES WHAT WAS MEASURED, never a generic "close some programs". Lists every
 * resource currently at `critical`, worst first, with its own figure: "RAM at 92% · disk at 94%" is
 * something a reader can act on, "your machine is under pressure" is not. `null` when nothing is
 * critical (the caller must not construct a sentence with nothing to put in it).
 */
export function pressureRecommendation(pressures: readonly ResourcePressure[], lang: 'pt' | 'en'): string | null {
  const critical = [...pressures].filter(p => p.level === 'critical').sort((a, b) => b.pct - a.pct)
  if (critical.length === 0) return null
  const pt = lang === 'pt'
  const parts = critical.map(p => {
    const label = RESOURCE_LABEL[p.resource][lang]
    const figure = p.resource === 'cpu'
      ? (pt ? `carga ${(p.pct / 100).toFixed(1)}×` : `load ${(p.pct / 100).toFixed(1)}×`)
      : `${Math.round(p.pct)}%`
    return pt ? `${label} em ${figure}` : `${label} at ${figure}`
  })
  return parts.join(' · ')
}
