/**
 * limits.ts — request-size and concurrency caps (OWASP API4, Unrestricted Resource Consumption).
 *
 * A JSON body is read through a byte counter rather than `req.json()` so an oversized payload is
 * abandoned mid-stream instead of being fully buffered first — otherwise the "limit" is applied
 * only after the memory has already been spent.
 *
 * The ingest cap is deliberately larger: a member's first push carries their whole history.
 */

export const LIMITS = {
  /** Default JSON body cap for API routes. */
  bodyBytes: 1_048_576, // 1 MiB
  /** POST /api/team/ingest — a full-history first push. */
  ingestBodyBytes: 24 * 1_048_576, // 24 MiB
  /** Maximum concurrently attached SSE clients. */
  sseClients: 200,
  /** Timeout for any outbound fetch this server makes (pricing table, FX rate, JWKS). */
  outboundTimeoutMs: 8_000,
} as const

export async function readJsonLimited<T>(
  req: Request,
  maxBytes: number,
): Promise<{ ok: true; value: T } | { ok: false; error: 'too_large' | 'invalid_json' }> {
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, error: 'too_large' }

  const body = req.body
  if (!body) return { ok: false, error: 'invalid_json' }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return { ok: false, error: 'too_large' }
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(merged)) as T }
  } catch {
    return { ok: false, error: 'invalid_json' }
  }
}
