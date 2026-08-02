/**
 * capability-guard.test.ts — the route→capability mapping and the 403 it produces.
 * Pure: every case passes an explicit Capabilities object, never the runtime singleton.
 */
import { describe, expect, it, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { routeCapability, capabilityDenied } from './capability-guard'
import { capabilitiesFor } from './exposure'

const publicCaps = capabilitiesFor('public', {
  central: true,
  exposure: 'public',
  allowLocalShell: true,
  tls: true,
})
const localCaps = capabilitiesFor('local', {
  central: false,
  exposure: undefined,
  allowLocalShell: false,
  tls: false,
})

describe('routeCapability', () => {
  it('maps the shell route', () => {
    expect(routeCapability('/api/exec')).toBe('localShell')
  })

  it('maps the local chat routes', () => {
    expect(routeCapability('/api/chat-tty')).toBe('localChat')
    expect(routeCapability('/api/chat-harnesses')).toBe('localChat')
  })

  it('maps every host transcript reader, including detail sub-paths', () => {
    expect(routeCapability('/api/claude-sessions')).toBe('localTranscripts')
    expect(routeCapability('/api/claude-sessions/abc-123')).toBe('localTranscripts')
    expect(routeCapability('/api/codex-sessions/x')).toBe('localTranscripts')
    expect(routeCapability('/api/gemini-sessions')).toBe('localTranscripts')
    expect(routeCapability('/api/copilot-sessions/y')).toBe('localTranscripts')
    expect(routeCapability('/api/nay-sessions')).toBe('localTranscripts')
    expect(routeCapability('/api/projects-list')).toBe('localTranscripts')
    expect(routeCapability('/api/team/proposals')).toBe('localTranscripts')
  })

  it('maps the mcp admin routes', () => {
    expect(routeCapability('/api/mcp-action')).toBe('mcpAdmin')
    expect(routeCapability('/api/mcp-list')).toBe('mcpAdmin')
  })

  it('returns null for ordinary metric routes', () => {
    expect(routeCapability('/api/data')).toBeNull()
    expect(routeCapability('/api/tags/abc')).toBeNull()
    expect(routeCapability('/api/health')).toBeNull()
  })

  it('does not match a route that merely starts with the same characters', () => {
    expect(routeCapability('/api/execute-order-66')).toBeNull()
    expect(routeCapability('/api/claude-sessions-export')).toBeNull()
  })
})

describe('capabilityDenied', () => {
  it('returns null when the capability is granted', () => {
    expect(capabilityDenied('localShell', localCaps)).toBeNull()
    expect(capabilityDenied('localTranscripts', localCaps)).toBeNull()
  })

  it('returns a 403 with a stable code when the capability is revoked', async () => {
    const res = capabilityDenied('localShell', publicCaps)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
    expect(await res!.json()).toEqual({ error: 'capability_disabled', capability: 'localShell' })
  })

  it('revokes the transcript readers on a public profile even with the opt-in flag set', () => {
    expect(capabilityDenied('localTranscripts', publicCaps)).not.toBeNull()
    expect(capabilityDenied('mcpAdmin', publicCaps)).not.toBeNull()
  })
})

test('/api/live-sessions is deliberately NOT blanket-guarded, and the reason is load-bearing', () => {
  // The route has two halves. Its LOCAL half reads /proc and IS gated — by `CAPS.localProcesses`,
  // inside the handler (`readLocalLiveSnapshot` in index.ts). Its other half, on a central, is the
  // members' own self-reported snapshots: not this host's state, and the whole reason the panel
  // exists there. Registering the path here would return 403 for both and take the central's
  // "Open now" down with the /proc read. If this ever becomes a single-purpose host route,
  // register it — until then the guard must stay silent about it on purpose.
  expect(routeCapability('/api/live-sessions')).toBeNull()
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf-8')
  expect(src).toContain('CAPS.localProcesses')
  // The gate must be the ONLY way into the /proc reader, or it is trivially bypassed by the next
  // route that wants a live snapshot. One import site = one place the capability is checked.
  expect(src.match(/import\('\.\/live-sessions'\)/g)?.length).toBe(1)
  const helper = src.slice(src.indexOf('async function readLocalLiveSnapshot'))
  expect(helper.indexOf('CAPS.localProcesses')).toBeLessThan(helper.indexOf("import('./live-sessions')"))
})
