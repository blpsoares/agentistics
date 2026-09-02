import { describe, expect, it } from 'bun:test'
import { HARNESS_ORDER } from '@agentistics/core'
import { SPAWN_SPECS } from './spawn-spec'
import { binOnPath, forgetProbes, harnessBin, missingBin, resolveStartable } from './harness-install'

/** Every harness agentop knows how to spawn, in the order the product lists them. */
const SPAWNABLE = HARNESS_ORDER.filter(h => SPAWN_SPECS[h] !== null)
const BINS = SPAWNABLE.map(h => SPAWN_SPECS[h]!.bin)

describe('resolveStartable', () => {
  it('offers every spawnable harness when all of them are on PATH', () => {
    const r = resolveStartable(() => true)
    expect(r.installed.map(i => i.id)).toEqual(SPAWNABLE)
    expect(r.missing).toEqual([])
  })

  it('offers NOTHING and names every command when none of them resolve', () => {
    const r = resolveStartable(() => false)
    expect(r.installed).toEqual([])
    expect(r.missing.map(m => m.id)).toEqual(SPAWNABLE)
    // The bin is the only actionable fact about the absence, so it must survive the split.
    expect(r.missing.map(m => m.bin)).toEqual(BINS)
  })

  it('splits the list when some resolve and some do not', () => {
    const present = new Set(['claude', 'codex'])
    const r = resolveStartable(b => present.has(b))
    expect(r.installed.map(i => i.id)).toEqual(['claude', 'codex'])
    expect(r.installed.map(i => i.bin)).toEqual(['claude', 'codex'])
    expect(r.missing.map(m => m.id)).not.toContain('claude')
    expect(r.missing.map(m => m.bin)).toContain('agy')
  })

  it('keeps HARNESS_ORDER, so the wizard never reorders itself as CLIs come and go', () => {
    const r = resolveStartable(b => b !== 'codex')
    const order = r.installed.map(i => i.id)
    expect(order).toEqual(SPAWNABLE.filter(h => h !== 'codex'))
  })

  it('probes each command exactly once', () => {
    const asked: string[] = []
    resolveStartable(b => { asked.push(b); return true })
    expect(asked).toEqual(BINS)
  })

  it('leaves a harness with no spawn spec out of BOTH lists', () => {
    // "agentop cannot start it" is planSpawn's refusal and a different sentence from "not
    // installed" — naming it here would send someone to install a CLI agentop still would not drive.
    const r = resolveStartable(() => true)
    const named = [...r.installed.map(i => i.id), ...r.missing.map(m => m.id)]
    for (const id of HARNESS_ORDER) {
      if (SPAWN_SPECS[id] === null) expect(named).not.toContain(id)
    }
  })

  it('carries the spec through, so the wizard can ask the questions the harness earns', () => {
    const r = resolveStartable(() => true)
    const claude = r.installed.find(i => i.id === 'claude')
    expect(claude?.spec).toBe(SPAWN_SPECS.claude!)
  })
})

describe('harnessBin', () => {
  it('names the command each spawnable harness runs', () => {
    expect(harnessBin('antigravity')).toBe('agy')
    expect(harnessBin('claude')).toBe('claude')
  })
})

describe('binOnPath', () => {
  it('finds a command that exists and does not find one that cannot', () => {
    forgetProbes()
    expect(binOnPath('sh')).toBe(true)
    expect(binOnPath('agentop-no-such-command-xyz')).toBe(false)
  })

  it('caches within the TTL and re-probes after it', () => {
    forgetProbes()
    const t0 = 1_000_000
    expect(binOnPath('agentop-no-such-command-xyz', t0)).toBe(false)
    // Inside the window the answer comes from the cache — the wizard, the fleet API and a spawn all
    // ask the same question within a second of each other.
    expect(binOnPath('agentop-no-such-command-xyz', t0 + 1_000)).toBe(false)
    // And it expires, so installing a CLI is picked up without restarting the cockpit.
    expect(binOnPath('sh', t0 + 60_000)).toBe(true)
  })
})

describe('missingBin', () => {
  it('says nothing about a harness agentop cannot spawn at all', () => {
    for (const id of HARNESS_ORDER) {
      if (SPAWN_SPECS[id] === null) expect(missingBin(id)).toBeNull()
    }
  })
})
