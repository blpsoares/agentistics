import { describe, expect, it } from 'bun:test'
import { readJsonLimited, LIMITS } from './limits'

const jsonReq = (body: string, headers: Record<string, string> = {}) =>
  new Request('http://x/api/test', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

describe('readJsonLimited', () => {
  it('parses a small valid body', async () => {
    expect(await readJsonLimited<{ a: number }>(jsonReq('{"a":1}'), 1000)).toEqual({ ok: true, value: { a: 1 } })
  })

  it('rejects a body over the limit by Content-Length before reading it', async () => {
    expect(await readJsonLimited(jsonReq('{"a":1}', { 'Content-Length': '999999' }), 100))
      .toEqual({ ok: false, error: 'too_large' })
  })

  it('rejects a body that exceeds the limit while streaming', async () => {
    expect(await readJsonLimited(jsonReq('x'.repeat(500)), 100)).toEqual({ ok: false, error: 'too_large' })
  })

  it('rejects malformed JSON', async () => {
    expect(await readJsonLimited(jsonReq('{not json'), 1000)).toEqual({ ok: false, error: 'invalid_json' })
  })

  it('rejects an empty body rather than returning undefined', async () => {
    const req = new Request('http://x/api/test', { method: 'POST' })
    expect(await readJsonLimited(req, 1000)).toEqual({ ok: false, error: 'invalid_json' })
  })

  it('accepts a body exactly at the limit', async () => {
    const body = JSON.stringify({ a: 'x'.repeat(50) })
    expect((await readJsonLimited(jsonReq(body), body.length)).ok).toBe(true)
  })
})

describe('LIMITS', () => {
  it('keeps the default body limit at 1 MiB and the ingest limit larger', () => {
    expect(LIMITS.bodyBytes).toBe(1_048_576)
    expect(LIMITS.ingestBodyBytes).toBeGreaterThan(LIMITS.bodyBytes)
  })

  it('bounds SSE clients and outbound fetches', () => {
    expect(LIMITS.sseClients).toBeGreaterThan(0)
    expect(LIMITS.outboundTimeoutMs).toBeGreaterThan(0)
  })
})
