import { describe, expect, test } from 'bun:test'
import {
  anyCritical, cpuPressure, CPU_LOAD_CRITICAL_RATIO, CPU_LOAD_WARN_RATIO, diskPressure,
  DISK_CRITICAL_PCT, DISK_WARN_PCT, pressureRecommendation, pressureTransition, ramPressure,
  RAM_CRITICAL_PCT, RAM_WARN_PCT, resourcesPressure, type ResourcePressure,
} from './hardwarePressure'

describe('ramPressure', () => {
  test('below warn reads ok', () => {
    expect(ramPressure(50, 100)!.level).toBe('ok')
  })
  test('at the warn threshold reads warn, not ok', () => {
    expect(ramPressure(RAM_WARN_PCT, 100)!.level).toBe('warn')
  })
  test('at the critical threshold reads critical, not warn', () => {
    expect(ramPressure(RAM_CRITICAL_PCT, 100)!.level).toBe('critical')
  })
  test('one pixel — one percentage point — under critical stays warn', () => {
    expect(ramPressure(RAM_CRITICAL_PCT - 1, 100)!.level).toBe('warn')
  })
  test('null input is unmeasured, never a confident 0', () => {
    expect(ramPressure(null, 100)).toBeNull()
    expect(ramPressure(50, null)).toBeNull()
  })
  test('a zero or negative total is unmeasured rather than Infinity/NaN', () => {
    expect(ramPressure(50, 0)).toBeNull()
    expect(ramPressure(50, -10)).toBeNull()
  })
  test('the pct is exact, not rounded', () => {
    expect(ramPressure(1, 3)!.pct).toBeCloseTo(33.333, 2)
  })
})

describe('diskPressure', () => {
  test('unavailable mount is unmeasured even with real byte figures', () => {
    expect(diskPressure(90, 100, false)).toBeNull()
  })
  test('available and past critical reads critical', () => {
    expect(diskPressure(DISK_CRITICAL_PCT, 100, true)!.level).toBe('critical')
  })
  test('available and past warn but under critical reads warn', () => {
    expect(diskPressure(DISK_WARN_PCT, 100, true)!.level).toBe('warn')
  })
  test('null bytes are unmeasured', () => {
    expect(diskPressure(null, 100, true)).toBeNull()
    expect(diskPressure(50, null, true)).toBeNull()
  })
})

describe('cpuPressure', () => {
  test('load at exactly the core count is the warn line, not critical', () => {
    expect(cpuPressure(4, 4)!.level).toBe('warn')
    expect(cpuPressure(4, 4)!.pct).toBeCloseTo(CPU_LOAD_WARN_RATIO * 100, 5)
  })
  test('load at 1.5x the core count is critical', () => {
    expect(cpuPressure(6, 4)!.level).toBe('critical')
    expect(cpuPressure(6, 4)!.pct).toBeCloseTo(CPU_LOAD_CRITICAL_RATIO * 100, 5)
  })
  test('load well under the core count is ok', () => {
    expect(cpuPressure(1, 4)!.level).toBe('ok')
  })
  test('no loadavg or no core count is unmeasured', () => {
    expect(cpuPressure(null, 4)).toBeNull()
    expect(cpuPressure(2, null)).toBeNull()
    expect(cpuPressure(2, 0)).toBeNull()
  })
})

describe('resourcesPressure', () => {
  test('a fully-measured snapshot returns all three, in ram/disk/cpu order', () => {
    const out = resourcesPressure({
      host: {
        usedMemoryBytes: 50, totalMemoryBytes: 100,
        disk: { usedBytes: 50, totalBytes: 100, available: true },
        loadavg: [2], cpuCores: 4,
      },
    })
    expect(out.map(p => p.resource)).toEqual(['ram', 'disk', 'cpu'])
  })

  test('an entirely unreadable host (a container with no /proc) returns an EMPTY list, not a false ok', () => {
    const out = resourcesPressure({
      host: {
        usedMemoryBytes: null, totalMemoryBytes: null,
        disk: { usedBytes: null, totalBytes: null, available: false },
        loadavg: null, cpuCores: null,
      },
    })
    expect(out).toEqual([])
  })

  test('a partially-readable host omits only what it could not measure', () => {
    const out = resourcesPressure({
      host: {
        usedMemoryBytes: 90, totalMemoryBytes: 100,
        disk: { usedBytes: null, totalBytes: null, available: false },
        loadavg: null, cpuCores: null,
      },
    })
    expect(out.map(p => p.resource)).toEqual(['ram'])
  })
})

describe('anyCritical', () => {
  test('true when at least one resource is critical', () => {
    const p: ResourcePressure[] = [{ resource: 'ram', pct: 10, level: 'ok' }, { resource: 'disk', pct: 95, level: 'critical' }]
    expect(anyCritical(p)).toBe(true)
  })
  test('false when everything is ok or warn', () => {
    const p: ResourcePressure[] = [{ resource: 'ram', pct: 72, level: 'warn' }]
    expect(anyCritical(p)).toBe(false)
  })
  test('false on an empty (unmeasured) list — never a confident false either way, but this is the caller’s honest floor', () => {
    expect(anyCritical([])).toBe(false)
  })
})

describe('pressureTransition — fires ONCE, exactly on the crossing INTO critical', () => {
  test('false -> true fires', () => {
    expect(pressureTransition(false, true)).toBe(true)
  })
  test('true -> true does NOT fire again (still critical, not a new crossing)', () => {
    expect(pressureTransition(true, true)).toBe(false)
  })
  test('true -> false does NOT fire (recovering is not a pressure event)', () => {
    expect(pressureTransition(true, false)).toBe(false)
  })
  test('false -> false does NOT fire', () => {
    expect(pressureTransition(false, false)).toBe(false)
  })
  test('null (no prior reading) -> true does NOT fire — there is nothing to have transitioned FROM', () => {
    expect(pressureTransition(null, true)).toBe(false)
  })
  test('null -> false does NOT fire', () => {
    expect(pressureTransition(null, false)).toBe(false)
  })

  // PLANTED-REVERT: a version that treats `null` as `false` would fire the instant an unreadable
  // machine became readable while already hot — announcing "pressure" for a state that may have
  // been true for hours before anyone could check.
  test('[planted-revert coverage] treating null as false wrongly fires on the first-ever reading', () => {
    function broken(prev: boolean | null, next: boolean): boolean {
      return (prev ?? false) === false && next === true // null coerced to false
    }
    expect(broken(null, true)).not.toBe(pressureTransition(null, true))
    expect(pressureTransition(null, true)).toBe(false)
  })
})

describe('pressureRecommendation', () => {
  test('null when nothing is critical', () => {
    const p: ResourcePressure[] = [{ resource: 'ram', pct: 72, level: 'warn' }]
    expect(pressureRecommendation(p, 'en')).toBeNull()
  })
  test('names the resource and its figure', () => {
    const p: ResourcePressure[] = [{ resource: 'ram', pct: 91.7, level: 'critical' }]
    expect(pressureRecommendation(p, 'en')).toBe('RAM at 92%')
    expect(pressureRecommendation(p, 'pt')).toBe('memória RAM em 92%')
  })
  test('CPU is stated as a load multiple, not a raw percent of nothing', () => {
    const p: ResourcePressure[] = [{ resource: 'cpu', pct: 180, level: 'critical' }]
    expect(pressureRecommendation(p, 'en')).toBe('CPU at load 1.8×')
  })
  test('several critical resources are listed WORST FIRST', () => {
    const p: ResourcePressure[] = [
      { resource: 'ram', pct: 86, level: 'critical' },
      { resource: 'disk', pct: 97, level: 'critical' },
    ]
    expect(pressureRecommendation(p, 'en')).toBe('disk at 97% · RAM at 86%')
  })
  test('a warn-level resource never appears in the recommendation, even alongside a critical one', () => {
    const p: ResourcePressure[] = [
      { resource: 'ram', pct: 72, level: 'warn' },
      { resource: 'disk', pct: 95, level: 'critical' },
    ]
    expect(pressureRecommendation(p, 'en')).toBe('disk at 95%')
  })
  test('does not mutate the caller’s array while sorting', () => {
    const p: ResourcePressure[] = [
      { resource: 'ram', pct: 86, level: 'critical' },
      { resource: 'disk', pct: 97, level: 'critical' },
    ]
    const before = p.map(x => x.resource)
    pressureRecommendation(p, 'en')
    expect(p.map(x => x.resource)).toEqual(before)
  })
})
