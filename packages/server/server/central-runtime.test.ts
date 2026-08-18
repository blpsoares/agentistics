import { test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CENTRAL_RUNTIMES,
  availableCentralRuntimes,
  centralRuntimeOptions,
  defaultCentralRuntime,
  flagFor,
  parseCentralUpFlags,
  parseStoredRuntime,
  resolveCentralRuntime,
  targetsBundledMongo,
  type CentralRuntimeFacts,
} from './central-runtime'
import { isBundledMongo, planCentralStart } from './cli-central'

const BUNDLED = 'mongodb://mongo:27017/?replicaSet=rs0'
const ATLAS = 'mongodb+srv://user:pw@cluster0.abcde.mongodb.net/agentistics'

function facts(over: Partial<CentralRuntimeFacts> = {}): CentralRuntimeFacts {
  return { script: false, docker: true, envFile: true, mongoUrl: BUNDLED, ...over }
}

test('a checkout with docker can do all three shapes when the database is external', () => {
  expect(availableCentralRuntimes(facts({ script: true, mongoUrl: ATLAS })))
    .toEqual(['docker-image', 'docker-build', 'native'])
})

test('without a checkout there is nothing to build, and the reason says so', () => {
  const opts = centralRuntimeOptions(facts({ script: false }))
  const build = opts.find(o => o.id === 'docker-build')!
  expect(build.available).toBe(false)
  expect(build.reason).toBe('no-checkout')
})

test('no docker blocks BOTH docker shapes, and only those', () => {
  const opts = centralRuntimeOptions(facts({ script: true, docker: false, mongoUrl: ATLAS }))
  expect(opts.filter(o => !o.available).map(o => o.reason)).toEqual(['no-docker', 'no-docker'])
  expect(availableCentralRuntimes(facts({ script: true, docker: false, mongoUrl: ATLAS })))
    .toEqual(['native'])
})

// The bundled Mongo is a Docker service; a native central would have nothing to connect to.
test('the bundled database blocks a native start', () => {
  const native = centralRuntimeOptions(facts({ mongoUrl: BUNDLED })).find(o => o.id === 'native')!
  expect(native.available).toBe(false)
  expect(native.reason).toBe('bundled-mongo')
})

// "not configured yet" and "configured for a database I cannot reach" send the user to different
// screens, so they must not collapse into one reason.
test('an unconfigured central blocks native with no-env, never with bundled-mongo', () => {
  const native = centralRuntimeOptions(facts({ envFile: false, mongoUrl: '' })).find(o => o.id === 'native')!
  expect(native.reason).toBe('no-env')
})

test('a box with neither docker nor an external database can run no central at all', () => {
  expect(defaultCentralRuntime(facts({ docker: false, mongoUrl: BUNDLED }))).toBeNull()
  const res = resolveCentralRuntime(undefined, facts({ docker: false, mongoUrl: BUNDLED }))
  expect(res).toEqual({ ok: false, id: null, reason: 'none-available' })
})

// The default must be exactly what planCentralStart decided before this module existed, or
// upgrading silently changes how every existing central comes up.
test('the default reproduces planCentralStart for every combination it can reach', () => {
  const plan = (id: string) => (id === 'docker-build' ? 'script' : id === 'docker-image' ? 'image' : 'native')
  for (const script of [true, false]) {
    for (const mongoUrl of [BUNDLED, ATLAS]) {
      const f = facts({ script, mongoUrl, envFile: true, docker: true })
      const got = defaultCentralRuntime(f)!
      expect(plan(got)).toBe(planCentralStart({ script, envFile: true, mongoUrl }))
    }
  }
})

// A requested runtime that cannot work is REFUSED. Falling back would start a central under a
// shape its operator did not choose, with nothing on screen saying so.
test('an impossible request is refused, never downgraded', () => {
  const res = resolveCentralRuntime('native', facts({ mongoUrl: BUNDLED }))
  expect(res).toEqual({ ok: false, id: 'native', reason: 'bundled-mongo' })

  const build = resolveCentralRuntime('docker-build', facts({ script: false }))
  expect(build).toEqual({ ok: false, id: 'docker-build', reason: 'no-checkout' })
})

test('resolve records whether the answer was the user\'s', () => {
  expect(resolveCentralRuntime('docker-image', facts())).toEqual({ ok: true, id: 'docker-image', chosen: true })
  expect(resolveCentralRuntime(undefined, facts({ script: true }))).toEqual({ ok: true, id: 'docker-build', chosen: false })
})

test('targetsBundledMongo agrees with cli-central\'s isBundledMongo', () => {
  const urls = [
    BUNDLED, ATLAS, '', 'mongodb://mongo:27017/agentistics', 'mongodb://user:pw@mongo:27017/db',
    'mongodb://localhost:27017', 'mongodb+srv://x@mongodb.example.com/db', 'mongodb://mongo2:27017/db',
  ]
  for (const u of urls) expect(targetsBundledMongo(u)).toBe(isBundledMongo(u))
})

test('flags parse, leaving everything else for the rebuild parser', () => {
  const res = parseCentralUpFlags(['--image', '-y', '--no-cache', '--bg'])
  expect(res.ok).toBe(true)
  if (!res.ok) return
  expect(res.flags).toEqual({ runtime: 'docker-image', how: 'bg' })
  expect(res.rest).toEqual(['-y', '--no-cache'])
})

test('two different runtimes are refused rather than resolved', () => {
  const res = parseCentralUpFlags(['--image', '--native'])
  expect(res.ok).toBe(false)
  if (res.ok) return
  expect(res.conflict).toEqual(['--image', '--native'])
})

test('repeating one answer is fine, in either spelling', () => {
  const res = parseCentralUpFlags(['--image', '--docker-image', '-d', '--bg'])
  expect(res.ok).toBe(true)
  if (!res.ok) return
  expect(res.flags).toEqual({ runtime: 'docker-image', how: 'bg' })
})

test('every runtime has a canonical flag, and it parses back to itself', () => {
  for (const id of CENTRAL_RUNTIMES) {
    const res = parseCentralUpFlags([flagFor(id)])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.flags.runtime).toBe(id)
  }
})

// A hand-edited typo must not be able to stop a central from starting.
test('a stored runtime is read back, and anything unrecognised falls back to the default', () => {
  expect(parseStoredRuntime('native')).toBe('native')
  expect(parseStoredRuntime(' docker-image ')).toBe('docker-image')
  expect(parseStoredRuntime('dockerimage')).toBeUndefined()
  expect(parseStoredRuntime('')).toBeUndefined()
  expect(parseStoredRuntime(undefined)).toBeUndefined()
})

// `packages/tui` may not import from `packages/server` (the dependency direction is server -> tui),
// so `CentralRuntimeId` is declared in both. This is what stops the two definitions drifting: a
// shape added here and not there would compile fine and simply never be offered by the cockpit.
test('the control center\'s CentralRuntimeId union matches this one, member for member', () => {
  const source = readFileSync(join(import.meta.dir, '..', '..', 'tui', 'src', 'control', 'types.ts'), 'utf8')
  const decl = source.match(/export type CentralRuntimeId = ([^\n]+)/)?.[1]
  expect(decl).toBeDefined()
  const members = [...decl!.matchAll(/'([a-z-]+)'/g)].map(m => m[1]!)
  expect(members.sort()).toEqual([...CENTRAL_RUNTIMES].sort())
})
