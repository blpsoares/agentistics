import { test, expect } from 'bun:test'
import {
  aggregateState,
  buildService,
  logRuntime,
  parseBootState,
  parseContainerFacts,
  parseElapsedSeconds,
  pidsToKill,
  targetRuntimes,
} from './cli-start'
import { cliStrings } from './cli-i18n'
import type { RuntimeId, ServiceRuntimeState } from '@agentistics/tui/control'

// Regression for the "kill and restart" self-termination bug: the CLI health check
// (`isServerRunning` → fetch to PORT) leaves a keep-alive client socket open, so
// `lsof -ti tcp:PORT` returns BOTH the server pid AND the CLI's own pid. Killing the
// full list SIGTERM'd the CLI itself ("Terminated") before it could restart the server.
// pidsToKill must never include the caller's own pid.

test('pidsToKill excludes the caller own pid', () => {
  // server pid 172382 + CLI own pid 175302 (as observed via lsof)
  expect(pidsToKill('172382\n175302', 175302)).toEqual(['172382'])
})

test('pidsToKill keeps all other pids and trims blanks', () => {
  expect(pidsToKill('  100 \n 200 \n\n300 ', 999)).toEqual(['100', '200', '300'])
})

test('pidsToKill returns empty when only own pid is present', () => {
  expect(pidsToKill('4242', 4242)).toEqual([])
})

test('pidsToKill handles empty lsof output', () => {
  expect(pidsToKill('', 123)).toEqual([])
})

// The control center states a service's uptime, and an uptime it cannot establish must read as
// absent. Both parsers below therefore answer `undefined` for anything they do not fully recognise
// — never a zero, which on screen is indistinguishable from "started just now".

test('parseElapsedSeconds reads the GNU `etimes` spelling (whole seconds)', () => {
  expect(parseElapsedSeconds('8054\n')).toBe(8054)
})

test('parseElapsedSeconds reads the BSD `etime` spelling', () => {
  expect(parseElapsedSeconds('  02:14  ')).toBe(134)
  expect(parseElapsedSeconds('01:02:03')).toBe(3723)
  expect(parseElapsedSeconds('2-03:04:05')).toBe(2 * 86400 + 3 * 3600 + 4 * 60 + 5)
})

test('parseElapsedSeconds refuses anything it does not recognise', () => {
  expect(parseElapsedSeconds('')).toBeUndefined()
  expect(parseElapsedSeconds('ps: no such process')).toBeUndefined()
  expect(parseElapsedSeconds('ELAPSED')).toBeUndefined()
})

test('parseContainerFacts reads pid, start time and the published host port', () => {
  const facts = parseContainerFacts(
    '48213|2026-07-28T18:44:02.113905Z|47291/tcp=48080 27017/tcp=27017 ',
  )
  expect(facts.pid).toBe(48213)
  expect(facts.startedAt).toBe(Date.parse('2026-07-28T18:44:02.113905Z'))
  expect(facts.hostPort).toBe(48080)
})

// A stopped container really does inspect as pid 0 at docker's zero time; neither is a fact.
test('parseContainerFacts drops the zero pid and the zero time of a stopped container', () => {
  const facts = parseContainerFacts('0|0001-01-01T00:00:00Z|')
  expect(facts.pid).toBeUndefined()
  expect(facts.startedAt).toBeUndefined()
  expect(facts.hostPort).toBeUndefined()
})

// The machine container runs on host networking, so it publishes nothing — and losing the port
// must not cost us the pid and the start time that came back on the same line.
test('parseContainerFacts keeps pid and start time when no port is published', () => {
  const facts = parseContainerFacts('9001|2026-07-28T10:00:00Z|')
  expect(facts.pid).toBe(9001)
  expect(facts.startedAt).toBe(Date.parse('2026-07-28T10:00:00Z'))
  expect(facts.hostPort).toBeUndefined()
})

test('parseContainerFacts survives an empty or malformed inspect answer', () => {
  expect(parseContainerFacts('')).toEqual({ pid: undefined, startedAt: undefined, hostPort: undefined })
  expect(parseContainerFacts('<no value>|<no value>|')).toEqual({
    pid: undefined, startedAt: undefined, hostPort: undefined,
  })
})

// ---------------------------------------------------------------------------
// the logical service model
// ---------------------------------------------------------------------------
//
// `agentistics` is ONE service with two runtimes (`local` natively, `machine` in a container) that
// CLAUDE.md says must never both run — they read the same files and fight over the same port.
// Everything below is the arithmetic that turns three detected runtimes into the two rows the user
// thinks about, and the reason the screen can no longer offer to start a container copy of a server
// that is already running.

const EN = cliStrings('en')
const PT = cliStrings('pt')

const runtime = (over: Partial<ServiceRuntimeState> & Pick<ServiceRuntimeState, 'id'>): ServiceRuntimeState => ({
  kind: over.id === 'local' ? 'native' : 'docker',
  state: 'down',
  available: true,
  ...over,
})

const NATIVE_UP = runtime({ id: 'local', state: 'up', pid: 48213, webUrl: 'http://localhost:47292' })
const NATIVE_DOWN = runtime({ id: 'local' })
const MACHINE_UP = runtime({ id: 'machine', state: 'up', pid: 71120 })
const MACHINE_DOWN = runtime({ id: 'machine' })
const MACHINE_NO_DOCKER = runtime({ id: 'machine', state: 'unknown', available: false, reason: EN.dockerMissing })
const MACHINE_BLIND = runtime({ id: 'machine', state: 'unknown', reason: EN.dockerUnreachable })

// -- target resolution -------------------------------------------------------
// A logical target acts on whichever runtime is ACTUALLY up. Getting this wrong is not cosmetic:
// `stop('agentistics')` resolving to the wrong half leaves the thing the user asked to stop running.

test('a logical target resolves to the runtime that is actually up', () => {
  expect(targetRuntimes('agentistics', ['local'])).toEqual(['local'])
  expect(targetRuntimes('agentistics', ['machine'])).toEqual(['machine'])
})

test('a logical target names BOTH runtimes when both are up — the conflict is acted on whole', () => {
  expect(targetRuntimes('agentistics', ['local', 'machine'])).toEqual(['local', 'machine'])
})

test('a logical target names nothing when the service is down, so the caller can say so', () => {
  expect(targetRuntimes('agentistics', [])).toEqual([])
  expect(targetRuntimes('agentistics', ['central'])).toEqual([])
})

test('a runtime target acts on exactly that runtime — how a conflict gets broken', () => {
  expect(targetRuntimes('local', ['local', 'machine'])).toEqual(['local'])
  expect(targetRuntimes('machine', ['local', 'machine'])).toEqual(['machine'])
})

test('a runtime target that is not running resolves to nothing', () => {
  expect(targetRuntimes('machine', ['local'])).toEqual([])
})

test("'all' is every running runtime, in canonical order, and never a stopped one", () => {
  expect(targetRuntimes('all', ['central', 'machine', 'local'])).toEqual(['local', 'machine', 'central'])
  expect(targetRuntimes('all', [])).toEqual([])
})

test("the central's service and runtime names mean the same thing", () => {
  expect(targetRuntimes('central', ['central'])).toEqual(['central'])
})

// -- log resolution ----------------------------------------------------------

test('a logical log source reads whichever runtime is up', () => {
  expect(logRuntime('agentistics', ['machine'])).toBe('machine')
  expect(logRuntime('agentistics', ['local'])).toBe('local')
})

test('with both up the log follows the declared preference rather than a coin toss', () => {
  expect(logRuntime('agentistics', ['local', 'machine'])).toBe('local')
})

// The most useful log of a server that is NOT running is the file the last one left behind.
test('a logical log source with nothing up falls back to the primary runtime', () => {
  expect(logRuntime('agentistics', [])).toBe('local')
  expect(logRuntime('central', [])).toBe('central')
})

test('a runtime log source reads that runtime whatever is up — the Logs screen selector', () => {
  expect(logRuntime('machine', ['local'])).toBe('machine')
  expect(logRuntime('local', ['machine'])).toBe('local')
})

// -- state aggregation -------------------------------------------------------

test('a service is up when any runtime is up', () => {
  expect(aggregateState([NATIVE_DOWN, MACHINE_UP])).toEqual({ state: 'up' })
})

test('a service is down only when every runtime is confidently down', () => {
  expect(aggregateState([NATIVE_DOWN, MACHINE_DOWN])).toEqual({ state: 'down' })
})

test('an undetectable runtime makes the service unknown, and carries its reason', () => {
  expect(aggregateState([NATIVE_DOWN, MACHINE_BLIND])).toEqual({
    state: 'unknown',
    reason: EN.dockerUnreachable,
  })
})

// Without docker there is no container to be uncertain about, so the honest `unknown` must not
// spread: otherwise every box without docker would read `agentistics ? unknown` forever.
test('a runtime this box cannot run at all does not make the service unknown', () => {
  expect(aggregateState([NATIVE_DOWN, MACHINE_NO_DOCKER])).toEqual({ state: 'down' })
})

test('a running runtime outranks an undetectable one — up is a fact, unknown is not', () => {
  expect(aggregateState([NATIVE_UP, MACHINE_BLIND])).toEqual({ state: 'up' })
})

// -- the assembled row -------------------------------------------------------

test('a running service offers NO start at all — only restart/stop/open remain', () => {
  const svc = buildService('agentistics', EN.svcAgentistics, [NATIVE_UP, MACHINE_DOWN], EN)
  expect(svc.state).toBe('up')
  expect(svc.startOptions).toEqual([])
  expect(svc.running).toEqual(['local'])
  expect(svc.active?.id).toBe('local')
  expect(svc.active?.pid).toBe(48213)
  expect(svc.conflict).toBeUndefined()
})

test('a stopped service keeps its row and offers exactly the starts this box can perform', () => {
  const svc = buildService('agentistics', EN.svcAgentistics, [NATIVE_DOWN, MACHINE_DOWN], EN)
  expect(svc.state).toBe('down')
  expect(svc.active).toBeUndefined()
  expect(svc.startOptions.map(o => [o.runtime, o.how, o.label])).toEqual([
    ['local', 'fg', EN.optForeground],
    ['local', 'bg', EN.optBackground],
    ['machine', undefined, EN.optDocker],
  ])
})

test('a runtime this box cannot run is not offered as a start that could not possibly work', () => {
  const svc = buildService('agentistics', EN.svcAgentistics, [NATIVE_DOWN, MACHINE_NO_DOCKER], EN)
  expect(svc.startOptions.map(o => o.runtime)).toEqual(['local', 'local'])
})

test('the central is one runtime, one start option', () => {
  const svc = buildService('central', EN.svcCentral, [runtime({ id: 'central' })], EN)
  expect(svc.startOptions).toEqual([
    { runtime: 'central', label: EN.optCentral, hint: EN.optCentralHint, offersBoot: true },
  ])
})

// Everything that has to happen AROUND a start is stated with the start, because this side is the
// one that knows it. The screen used to re-derive all three from `option.runtime !== 'local'`,
// which is this model restated in the layer that draws boxes — and wrong the day a second runtime
// takes a port.
test('a start states what must happen around it: the port, the gate, the boot unit', () => {
  const svc = buildService('agentistics', EN.svcAgentistics, [NATIVE_DOWN, MACHINE_DOWN], EN)
  const [fg, bg, docker] = svc.startOptions

  // The native runtime is the one holding the api port, both ways of starting it.
  expect(fg!.blockedBy).toBe('local')
  expect(bg!.blockedBy).toBe('local')
  expect(docker!.blockedBy).toBeUndefined()

  // The consent gate belongs to the process that will be writing history here.
  expect([fg!.asksArchive, bg!.asksArchive]).toEqual([true, true])
  expect(docker!.asksArchive).toBeUndefined()

  // Only what is meant to outlive this terminal is worth a boot unit — and never the container,
  // which Docker already restores.
  expect(bg!.offersBoot).toBe(true)
  expect(fg!.offersBoot).toBeUndefined()
  expect(docker!.offersBoot).toBeUndefined()
})

// The state the screen must never tidy away: showing one of the two would have the user act on a
// half-truth about a machine where two copies are fighting over the same port and the same files.
test('both runtimes up is reported as a conflict that NAMES them, not as one of them', () => {
  const svc = buildService('agentistics', EN.svcAgentistics, [NATIVE_UP, MACHINE_UP], EN)
  expect(svc.state).toBe('up')
  expect(svc.running).toEqual(['local', 'machine'])
  expect(svc.conflict).toContain('native')
  expect(svc.conflict).toContain('docker')
  // A word, not a colour: the row is painted danger, and colour alone carries nothing.
  expect(svc.conflict).toContain('conflict')
  expect(svc.startOptions).toEqual([])
})

// The sentence is drawn into the detail pane, which on a narrow terminal is under thirty columns
// and truncates from the right. Leading with the word and both names is what keeps a conflict from
// reading, at exactly those sizes, as a red line naming one runtime.
test('the conflict names the word and BOTH runtimes before it can be cut', () => {
  for (const s of [EN, PT]) {
    const svc = buildService('agentistics', s.svcAgentistics, [NATIVE_UP, MACHINE_UP], s)
    const head = (svc.conflict ?? '').slice(0, 26)
    // `conflict` / `conflito` — the same word in both languages, and it leads the sentence.
    expect(head.toLowerCase()).toMatch(/^conflic?t/)
    expect(head).toContain('native')
    expect(head).toContain('docker')
  }
})

test('a conflict offers a stop per runtime, so it can be broken without guessing', () => {
  const svc = buildService('agentistics', EN.svcAgentistics, [NATIVE_UP, MACHINE_UP], EN)
  expect(svc.stopOptions).toEqual([
    { runtime: 'local', label: 'Stop (native)' },
    { runtime: 'machine', label: 'Stop (docker)' },
  ])
})

test('a single running runtime is not a conflict and offers no per-runtime stop', () => {
  const svc = buildService('agentistics', EN.svcAgentistics, [NATIVE_UP, MACHINE_DOWN], EN)
  expect(svc.stopOptions).toEqual([])
})

test('the conflict sentence and the start options are localized', () => {
  const svc = buildService('agentistics', PT.svcAgentistics, [NATIVE_UP, MACHINE_UP], PT)
  expect(svc.conflict).toBe('conflito: native + docker rodando juntos — pare um')
  const down = buildService('agentistics', PT.svcAgentistics, [NATIVE_DOWN, MACHINE_DOWN], PT)
  expect(down.startOptions.map(o => o.label)).toEqual([
    'Iniciar (neste terminal)', 'Iniciar (background)', 'Iniciar (docker)',
  ])
})

test('an undetectable service still says why, and is still startable', () => {
  const svc = buildService('agentistics', EN.svcAgentistics, [NATIVE_DOWN, MACHINE_BLIND], EN)
  expect(svc.state).toBe('unknown')
  expect(svc.reason).toBe(EN.dockerUnreachable)
  expect(svc.startOptions.map(o => o.runtime)).toEqual<RuntimeId[]>(['local', 'local', 'machine'])
})

// ---------------------------------------------------------------------------
// boot state — the one fact on this screen that only an OS probe can answer
// ---------------------------------------------------------------------------

test('parseBootState reads the words systemd actually prints', () => {
  expect(parseBootState('enabled')).toBe('on')
  expect(parseBootState('enabled-runtime\n')).toBe('on')
  expect(parseBootState('linked')).toBe('on')
  expect(parseBootState('disabled')).toBe('off')
  expect(parseBootState('masked')).toBe('off')
})

test('parseBootState never INVENTS an off — an unknown answer is silence', () => {
  // This is the whole reason the field is optional. A detail pane that says "does not start at
  // boot" because systemd was never asked is a fact the user acts on by installing a unit they
  // already have — the same rule the dashboard applies to a capability it cannot measure.
  for (const out of ['', '   ', 'not-found', 'static', 'indirect', 'alias', 'generated', 'transient',
    'Failed to get unit file state for agentop-server.service: No such file or directory']) {
    expect(parseBootState(out)).toBeUndefined()
  }
})

test('parseBootState reads the FIRST line, which is where systemd puts the word', () => {
  expect(parseBootState('enabled\nsome trailing noise')).toBe('on')
})

test('buildService says nothing about boot unless it was told', () => {
  const s = cliStrings('en')
  const runtimes: ServiceRuntimeState[] = [
    { id: 'local', kind: 'native', state: 'down', available: true },
  ]
  expect(buildService('agentistics', s.svcAgentistics, runtimes, s).boot).toBeUndefined()
  expect(buildService('agentistics', s.svcAgentistics, runtimes, s, { boot: 'on' }).boot).toBe('on')
  expect(buildService('agentistics', s.svcAgentistics, runtimes, s, { boot: 'off' }).boot).toBe('off')
})
