/**
 * member-connect-args.test.ts — the argv gate for `agentop member connect`.
 *
 * The regression these pin: the CLI demanded `--endpoint` even for a composite `act1_…` token that
 * already carries the URL, so the exact command the central's Machines panel prints (and the one
 * shown after a token rotation) was answered with a usage line and exit 1.
 */

import { describe, expect, test } from 'bun:test'
import { packConnectToken } from '@agentistics/core'
import { parseMemberConnectArgs } from './member-connect-args'

const SECRET = 'a09e195366d8f472a7cb8001d482819957b12f4887d4896056d6a7911899f226'
const CENTRAL = 'https://central.blpsoares.dev'
const COMPOSITE = packConnectToken(SECRET, CENTRAL)

describe('parseMemberConnectArgs', () => {
  test('accepts the composite token ALONE — the command the central tells you to paste', () => {
    const parsed = parseMemberConnectArgs(['--token', COMPOSITE])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.opts.token).toBe(COMPOSITE)
    // The endpoint is NOT resolved here: `memberConnect` unpacks the token and owns that rule.
    // What matters is that the gate no longer invents a requirement the token already satisfies.
    expect(parsed.opts.endpoint).toBeUndefined()
  })

  test('a raw secret with --endpoint still works (the pre-composite form)', () => {
    const parsed = parseMemberConnectArgs(['--endpoint', 'http://host:48080', '--token', SECRET])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.opts.endpoint).toBe('http://host:48080')
    expect(parsed.opts.token).toBe(SECRET)
  })

  test('a raw secret with NO endpoint is still accepted by the gate — memberConnect refuses it, in words', () => {
    // The gate must not be the place that decides whether an endpoint can be resolved: it cannot
    // see inside the token. Passing it through is what lets the user read an actionable message
    // ("needs --endpoint <url> (or a token with the URL embedded)") instead of a usage block.
    const parsed = parseMemberConnectArgs(['--token', SECRET])
    expect(parsed.ok).toBe(true)
  })

  test('no token at all → usage, and the usage names the token-only form', () => {
    const parsed = parseMemberConnectArgs(['--endpoint', 'http://host:48080'])
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.usage).toContain('--token')
    expect(parsed.usage).toContain('agentop member connect --token')
  })

  test('--token with no value is a missing token, not an empty one', () => {
    const parsed = parseMemberConnectArgs(['--token'])
    expect(parsed.ok).toBe(false)
  })

  test('org and label are passed through; absent flags stay undefined, never empty strings', () => {
    const parsed = parseMemberConnectArgs(['--token', COMPOSITE, '--org', 'acme', '--label', 'Client B'])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.opts.org).toBe('acme')
    expect(parsed.opts.label).toBe('Client B')

    const bare = parseMemberConnectArgs(['--token', COMPOSITE])
    expect(bare.ok).toBe(true)
    if (!bare.ok) return
    expect(bare.opts.org).toBeUndefined()
    expect(bare.opts.label).toBeUndefined()
  })

  test('flag order does not matter', () => {
    const parsed = parseMemberConnectArgs(['--label', 'Laptop', '--token', COMPOSITE, '--org', 'acme'])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.opts.token).toBe(COMPOSITE)
    expect(parsed.opts.label).toBe('Laptop')
  })
})
