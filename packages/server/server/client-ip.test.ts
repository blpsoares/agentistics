/**
 * client-ip.test.ts — spoofing is the whole point of these tests: a forwarded header must
 * only be believed when the deployment says a trusted proxy rewrites it.
 */
import { describe, expect, it } from 'bun:test'
import { resolveClientIp } from './client-ip'

const h = (o: Record<string, string>) => new Headers(o)

describe('resolveClientIp', () => {
  it('uses the socket address when the proxy is not trusted', () => {
    const ip = resolveClientIp({
      socketAddress: '10.0.0.5',
      headers: h({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }),
      trustProxy: false,
    })
    expect(ip).toBe('10.0.0.5')
  })

  it('prefers CF-Connecting-IP when the proxy is trusted', () => {
    const ip = resolveClientIp({
      socketAddress: '172.71.0.1',
      headers: h({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9, 8.8.8.8' }),
      trustProxy: true,
    })
    expect(ip).toBe('1.2.3.4')
  })

  it('falls back to the left-most X-Forwarded-For entry when trusted', () => {
    const ip = resolveClientIp({
      socketAddress: '172.71.0.1',
      headers: h({ 'x-forwarded-for': '  9.9.9.9 , 8.8.8.8 ' }),
      trustProxy: true,
    })
    expect(ip).toBe('9.9.9.9')
  })

  it('ignores a malformed forwarded value and falls back to the socket', () => {
    const ip = resolveClientIp({
      socketAddress: '172.71.0.1',
      headers: h({ 'cf-connecting-ip': 'not-an-ip' }),
      trustProxy: true,
    })
    expect(ip).toBe('172.71.0.1')
  })

  it('rejects an out-of-range octet', () => {
    const ip = resolveClientIp({
      socketAddress: '10.0.0.1',
      headers: h({ 'cf-connecting-ip': '999.1.1.1' }),
      trustProxy: true,
    })
    expect(ip).toBe('10.0.0.1')
  })

  it('accepts an IPv6 address', () => {
    const ip = resolveClientIp({
      socketAddress: '::1',
      headers: h({}),
      trustProxy: false,
    })
    expect(ip).toBe('::1')
  })

  it('returns the fail-closed sentinel when nothing is resolvable', () => {
    expect(resolveClientIp({ socketAddress: null, headers: h({}), trustProxy: false })).toBe('unknown')
    expect(resolveClientIp({ socketAddress: 'garbage', headers: h({}), trustProxy: true })).toBe('unknown')
  })
})
