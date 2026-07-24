import { describe, expect, test } from 'bun:test'
import { buildCentralEnv, STANDALONE_COMPOSE, isCentralAction, CENTRAL_ACTIONS, isBundledMongo, looksLikeMongoUri, BUNDLED_MONGO_URL } from './cli-central'

/** Parse the `KEY=value` lines of a central.env blob into a map (ignores comments/blanks). */
function parseEnv(blob: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of blob.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    out[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return out
}

describe('buildCentralEnv', () => {
  test('applies defaults and auto-generates secrets when omitted', () => {
    const env = parseEnv(buildCentralEnv())
    expect(env.APP_PORT).toBe('48080')
    expect(env.BIND_IP).toBe('0.0.0.0')
    expect(env.AGENTISTICS_TEAM_ORG).toBe('default')
    expect(env.AGENTISTICS_TEAM_CENTRAL).toBe('1')
    // hex(24) → 48 hex chars, hex(32) → 64 hex chars.
    expect(env.AGENTISTICS_TEAM_PASSWORD).toMatch(/^[0-9a-f]{48}$/)
    expect(env.AGENTISTICS_TEAM_SESSION_SECRET).toMatch(/^[0-9a-f]{64}$/)
    // Ingest token defaults to empty (teams use per-member minted tokens).
    expect(env.AGENTISTICS_TEAM_INGEST_TOKEN).toBe('')
    expect(env.AGENTISTICS_CENTRAL_USER).toBe('')
    // Mongo is internal — the env points the app at the compose service, not localhost.
    expect(env.MONGO_URL).toContain('mongo:27017')
  })

  test('honors provided values verbatim (no random override)', () => {
    const env = parseEnv(buildCentralEnv({
      port: '9000',
      org: 'acme',
      password: 'my-pass',
      sessionSecret: 'my-secret',
      ingestToken: 'shared-tok',
      bind: '100.64.0.5',
    }))
    expect(env.APP_PORT).toBe('9000')
    expect(env.BIND_IP).toBe('100.64.0.5')
    expect(env.AGENTISTICS_TEAM_ORG).toBe('acme')
    expect(env.AGENTISTICS_TEAM_PASSWORD).toBe('my-pass')
    expect(env.AGENTISTICS_TEAM_SESSION_SECRET).toBe('my-secret')
    expect(env.AGENTISTICS_TEAM_INGEST_TOKEN).toBe('shared-tok')
  })

  test('two calls generate distinct secrets', () => {
    const a = parseEnv(buildCentralEnv())
    const b = parseEnv(buildCentralEnv())
    expect(a.AGENTISTICS_TEAM_PASSWORD).not.toBe(b.AGENTISTICS_TEAM_PASSWORD)
    expect(a.AGENTISTICS_TEAM_SESSION_SECRET).not.toBe(b.AGENTISTICS_TEAM_SESSION_SECRET)
  })
})

describe('STANDALONE_COMPOSE', () => {
  test('pulls the published image and never builds from source', () => {
    // The whole point of the standalone path: pull, not build (no repo present).
    expect(STANDALONE_COMPOSE).toContain('ghcr.io/blpsoares/agentistics')
    expect(STANDALONE_COMPOSE).toContain('${AGENTISTICS_IMAGE')
    expect(STANDALONE_COMPOSE).not.toContain('build:')
  })

  test('wires every central.env value the app + ports depend on', () => {
    for (const key of [
      'APP_PORT', 'BIND_IP', 'MONGO_URL', 'AGENTISTICS_TEAM_ORG',
      'AGENTISTICS_TEAM_PASSWORD', 'AGENTISTICS_TEAM_SESSION_SECRET', 'AGENTISTICS_TEAM_INGEST_TOKEN',
    ]) {
      expect(STANDALONE_COMPOSE).toContain(`\${${key}`)
    }
    // Central mode + static serving must be forced on regardless of env.
    expect(STANDALONE_COMPOSE).toContain('AGENTISTICS_TEAM_CENTRAL: "1"')
    expect(STANDALONE_COMPOSE).toContain('SERVE_STATIC: "1"')
    // The internal Mongo container is defined and its data volume declared.
    expect(STANDALONE_COMPOSE).toContain('mongo:7')
    expect(STANDALONE_COMPOSE).toContain('mongo_data:')
  })
})

describe('isCentralAction', () => {
  test('accepts exactly the documented actions', () => {
    for (const a of CENTRAL_ACTIONS) expect(isCentralAction(a)).toBe(true)
    expect(isCentralAction('bogus')).toBe(false)
    expect(isCentralAction('')).toBe(false)
  })
})

describe('external database (Atlas) support', () => {
  function parseEnv(blob: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const line of blob.split('\n')) {
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq !== -1) out[line.slice(0, eq)] = line.slice(eq + 1)
    }
    return out
  }

  test('buildCentralEnv writes an external MONGO_URL when given, else the bundled one', () => {
    expect(parseEnv(buildCentralEnv()).MONGO_URL).toBe(BUNDLED_MONGO_URL)
    const atlas = 'mongodb+srv://u:p@cluster.abc.mongodb.net/?retryWrites=true'
    expect(parseEnv(buildCentralEnv({ mongoUrl: atlas })).MONGO_URL).toBe(atlas)
  })

  test('isBundledMongo distinguishes the Docker service from external URIs', () => {
    expect(isBundledMongo(BUNDLED_MONGO_URL)).toBe(true)
    expect(isBundledMongo('mongodb://mongo:27017/?replicaSet=rs0')).toBe(true)
    expect(isBundledMongo('mongodb+srv://u:p@cluster.abc.mongodb.net/')).toBe(false)
    expect(isBundledMongo('mongodb://my-vps.example.com:27017/db')).toBe(false)
    expect(isBundledMongo('')).toBe(false)
  })

  test('looksLikeMongoUri validates connection strings', () => {
    expect(looksLikeMongoUri('mongodb://host:27017/db')).toBe(true)
    expect(looksLikeMongoUri('mongodb+srv://u:p@c.mongodb.net/')).toBe(true)
    expect(looksLikeMongoUri('  mongodb+srv://x  ')).toBe(true)
    expect(looksLikeMongoUri('http://nope')).toBe(false)
    expect(looksLikeMongoUri('mongodb://')).toBe(false)
    expect(looksLikeMongoUri('')).toBe(false)
  })
})
