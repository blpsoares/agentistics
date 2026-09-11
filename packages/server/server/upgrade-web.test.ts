import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { upgradeBinary } from './upgrade-web'

describe('which binary an in-page upgrade would run', () => {
  test('a compiled agentop runs itself — the exact binary the upgrade replaces', () => {
    expect(upgradeBinary('/home/u/.local/bin/agentop')).toBe('/home/u/.local/bin/agentop')
    expect(upgradeBinary('/usr/local/bin/agentop-linux-x64')).toBe('/usr/local/bin/agentop-linux-x64')
  })

  // Under `bun server/index.ts` the execPath is bun. Spawning `upgrade` there would ask BUN to
  // upgrade itself, and a development checkout updates with git anyway.
  test('a source checkout runs nothing', () => {
    expect(upgradeBinary('/home/u/.bun/bin/bun')).toBeNull()
    expect(upgradeBinary('/usr/bin/node')).toBeNull()
    expect(upgradeBinary('')).toBeNull()
  })
})

/**
 * A LINT OVER THIS MODULE'S OWN SOURCE, in the shape `shell-isolation.test.ts` uses.
 *
 * `upgrade.ts` finds the servers to restart with `pgrep -f 'agentop.*(server|start)'` and EXCLUDES
 * its own pid and its PPID. Spawned as a child of this server, the server is the ppid: it would be
 * skipped, the upgrade would report success, and the machine would keep serving the old bundle off
 * a new binary. Nothing about that is visible from inside — which is why it is asserted here rather
 * than trusted to survive a refactor.
 */
describe('the upgrade must not be this process’s child', () => {
  const src = readFileSync(new URL('./upgrade-web.ts', import.meta.url), 'utf8')

  test('the spawn is detached and unref’d', () => {
    expect(src).toContain('detached: true')
    expect(src).toContain('.unref()')
  })

  test('it never inherits this server’s stdio, which would outlive the restart', () => {
    expect(src).toContain("stdio: 'ignore'")
    expect(src).not.toContain("stdio: 'inherit'")
  })
})
