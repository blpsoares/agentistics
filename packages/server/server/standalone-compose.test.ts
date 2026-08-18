import { test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { STANDALONE_COMPOSE, STANDALONE_LOCALDB_COMPOSE } from './cli-central'

/**
 * The published-image central exists TWICE: as `docker/central.image.yml` in the repository, which
 * is what a reader reviews and what a checkout runs, and as a string inside `cli-central.ts`, which
 * is what the compiled binary materialises for someone who never cloned anything. Two copies of one
 * deployment is exactly the shape that drifts, and it did — silently, in the direction that matters:
 *
 *  • the string carried NONE of the exposure variables, so `AGENTISTICS_EXPOSURE=public` in
 *    central.env was inert and the instance stayed on the `lan` profile with its host-power routes
 *    live, while its operator had every reason to believe otherwise;
 *  • it mounted the data volume at /root/.agentistics while the image runs with HOME=/data, so the
 *    only writable copy of preferences and sync state lived in the container layer that every
 *    `up --force-recreate` throws away.
 *
 * Neither is visible from outside the container, which is why this is a test and not a comment.
 * It pins the PROPERTIES that broke rather than the bytes: formatting and comments may differ, the
 * variables and the paths may not.
 */

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const imageYml = readFileSync(join(REPO_ROOT, 'docker', 'central.image.yml'), 'utf8')
const localdbYml = readFileSync(join(REPO_ROOT, 'docker', 'central.localdb.yml'), 'utf8')

/** Every `AGENTISTICS_*` key the compose passes into the container, ignoring comments. */
function envKeys(yaml: string): Set<string> {
  const keys = new Set<string>()
  for (const raw of yaml.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('#')) continue
    const m = line.match(/^(AGENTISTICS_[A-Z_]+):/)
    if (m) keys.add(m[1]!)
  }
  return keys
}

test('the generated compose passes exactly the variables the repo file does', () => {
  expect([...envKeys(STANDALONE_COMPOSE)].sort()).toEqual([...envKeys(imageYml)].sort())
})

// The list is asserted literally too: a variable dropped from BOTH files at once would satisfy the
// comparison above while quietly removing an exposure control from every deployment path.
test('every exposure variable is present, named', () => {
  const keys = envKeys(STANDALONE_COMPOSE)
  for (const key of [
    'AGENTISTICS_EXPOSURE',
    'AGENTISTICS_ALLOW_LOCAL_SHELL',
    'AGENTISTICS_TRUST_PROXY',
    'AGENTISTICS_TEAM_TLS',
    'AGENTISTICS_ALLOWED_ORIGINS',
    'AGENTISTICS_INGEST_ONLY',
    'AGENTISTICS_OIDC_AUDIENCE',
    'AGENTISTICS_OIDC_ISSUER',
  ]) {
    expect(keys).toContain(key)
  }
})

test('the data volume is mounted where the image actually has its home', () => {
  expect(STANDALONE_COMPOSE).toContain('agentistics_data:/data/.agentistics')
  expect(imageYml).toContain('agentistics_data:/data/.agentistics')
  // The old path. It is not merely absent — naming it here is what makes the regression loud.
  expect(STANDALONE_COMPOSE).not.toContain('/root/.agentistics')
})

test('a generated file never puts the central on the network', () => {
  expect(STANDALONE_COMPOSE).toContain('${BIND_IP:-127.0.0.1}')
  expect(imageYml).toContain('${BIND_IP:-127.0.0.1}')
  expect(STANDALONE_COMPOSE).not.toContain('${BIND_IP:-0.0.0.0}')
})

test('the generated central is hardened the same way the repo one is', () => {
  for (const marker of ['user: "10001:10001"', 'read_only: true', 'no-new-privileges:true', 'cap_drop']) {
    expect(STANDALONE_COMPOSE).toContain(marker)
    expect(imageYml).toContain(marker)
  }
})

// Both stacks must be ONE project, or an `--image` run beside a `--build` run silently creates a
// second central with its own empty database.
test('both compose paths pin the same project name', () => {
  expect(STANDALONE_COMPOSE).toContain('name: team-mode')
  expect(imageYml).toContain('name: team-mode')
})

test('the bundled-Mongo overlay is the same service, unpublished, in both copies', () => {
  for (const yaml of [STANDALONE_LOCALDB_COMPOSE, localdbYml]) {
    expect(yaml).toContain('image: mongo:7')
    expect(yaml).toContain('--replSet rs0')
    expect(yaml).toContain('mongo_data:/data/db')
    // Publishing 27017 would put the database on the host, which the exposure runbook forbids.
    expect(yaml).not.toMatch(/^\s*-\s*"?\d*:?27017:27017/m)
  }
})

// `depends_on` belongs to the OVERLAY, not the app: with an external cluster there is no `mongo`
// service defined anywhere, and a depends_on naming an undefined service is a hard compose error.
test('the app depends on mongo only where mongo exists', () => {
  expect(STANDALONE_COMPOSE).not.toContain('depends_on')
  expect(STANDALONE_LOCALDB_COMPOSE).toContain('depends_on')
})
