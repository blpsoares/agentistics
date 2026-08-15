import { describe, it, expect } from 'bun:test'
import { idleServers, isServerCommand } from './idle-servers'

describe('isServerCommand', () => {
  it('matches both forms that actually collided', () => {
    // Verbatim from the machine where two servers ran for seventy minutes. They look nothing alike,
    // which is exactly why the match is on the SUBCOMMAND and not on the binary's name.
    expect(isServerCommand('/home/mithrandir/.local/bin/agentop server')).toBe(true)
    expect(isServerCommand('bun packages/server/bin/cli.ts server')).toBe(true)
    expect(isServerCommand('/home/x/.volta/tools/image/packages/bun/bin/bun packages/server/bin/cli.ts server')).toBe(true)
  })

  it('does not match the other agentop verbs', () => {
    expect(isServerCommand('agentop session ls')).toBe(false)
    expect(isServerCommand('agentop check-update')).toBe(false)
    expect(isServerCommand('agentop central up')).toBe(false)
  })

  it('does not match a command line that merely mentions it', () => {
    // A `grep` in somebody's pipeline is not a server, and reporting it would train people to
    // ignore the warning — which is the only way this feature can fail.
    expect(isServerCommand('grep agentop server')).toBe(false)
    expect(isServerCommand('server')).toBe(false)
    expect(isServerCommand('vim notes-about-agentop-server.md')).toBe(false)
  })
})

describe('idleServers', () => {
  const listener = { pid: 517, command: '/home/x/.local/bin/agentop server' }
  const orphan = { pid: 3189270, command: 'bun packages/server/bin/cli.ts server' }

  it('names the one that is running and serving nothing', () => {
    const r = idleServers({ processes: [listener, orphan], listening: [517], self: 999 })
    expect(r.idle.map(p => p.pid)).toEqual([3189270])
    expect(r.listener).toBe(517)
  })

  it('never reports the listener', () => {
    expect(idleServers({ processes: [listener], listening: [517], self: 999 }).idle).toEqual([])
  })

  it('never reports ITSELF', () => {
    // The cockpit runs inside an `agentop`. A rule without this reports a conflict on every healthy
    // machine, which is worse than reporting nothing at all.
    const me = { pid: 4242, command: '/home/x/.local/bin/agentop server' }
    expect(idleServers({ processes: [listener, me], listening: [517], self: 4242 }).idle).toEqual([])
  })

  it('reports a server running while NOBODY holds the port', () => {
    // Still waste, and still worth naming: it is doing the watcher's work and answering no request.
    const r = idleServers({ processes: [orphan], listening: [], self: 999 })
    expect(r.idle.map(p => p.pid)).toEqual([3189270])
    expect(r.listener).toBeUndefined()
  })
})
