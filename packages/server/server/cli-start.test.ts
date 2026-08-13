import { test, expect } from 'bun:test'
import {
  aggregateState,
  buildService,
  logRuntime,
  parseBootState,
  parseContainerFacts,
  parseElapsedSeconds,
  pidsToKill,
  sessionSnapshot,
  startOptionsFor,
  targetRuntimes,
} from './cli-start'
import { cliStrings } from './cli-i18n'
import type { BackendSession, ManagedSession, SessionBackend } from './sessions/types'
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
  // Every runtime that can run now offers BOTH shapes — attached and detached — not just `local`.
  expect(svc.startOptions.map(o => [o.runtime, o.how, o.label])).toEqual([
    ['local', 'fg', EN.optForeground],
    ['local', 'bg', EN.optBackground],
    ['machine', 'fg', EN.optDockerForeground],
    ['machine', 'bg', EN.optDockerBackground],
  ])
})

test('a runtime this box cannot run is not offered as a start that could not possibly work', () => {
  const svc = buildService('agentistics', EN.svcAgentistics, [NATIVE_DOWN, MACHINE_NO_DOCKER], EN)
  expect(svc.startOptions.map(o => o.runtime)).toEqual(['local', 'local'])
})

test('the Docker central offers one shape — background — with no plan or a Docker plan', () => {
  const svc = buildService('central', EN.svcCentral, [runtime({ id: 'central' })], EN)
  expect(svc.startOptions).toEqual([
    { runtime: 'central', how: 'bg', label: EN.optCentral, hint: EN.optCentralHint, offersBoot: true },
  ])
  for (const centralPlan of ['script', 'image', 'init'] as const) {
    expect(startOptionsFor('central', EN, { centralPlan })).toEqual([
      { runtime: 'central', how: 'bg', label: EN.optCentral, hint: EN.optCentralHint, offersBoot: true },
    ])
  }
})

// A native central (external Mongo, standalone/no-repo) is the ONE case `runCentral` can run the
// binary directly instead of Docker — see `planCentralStart` in cli-central.ts. It offers BOTH
// shapes, neither of which carries `offersBoot`: foreground because it holds the terminal, and
// background because no native-central systemd unit exists yet (see the field's own doc).
test('a native-capable central offers foreground AND background, neither with a boot unit', () => {
  const options = startOptionsFor('central', EN, { centralPlan: 'native' })
  expect(options).toEqual([
    { runtime: 'central', how: 'fg', label: EN.optCentralNativeForeground, hint: EN.optCentralNativeForegroundHint },
    { runtime: 'central', how: 'bg', label: EN.optCentralNativeBackground, hint: EN.optCentralNativeBackgroundHint },
  ])
  expect(options.every(o => o.offersBoot === undefined)).toBe(true)
})

// Everything that has to happen AROUND a start is stated with the start, because this side is the
// one that knows it. The screen used to re-derive all three from `option.runtime !== 'local'`,
// which is this model restated in the layer that draws boxes — and wrong the day a second runtime
// takes a port.
test('a start states what must happen around it: the port, the gate, the boot unit', () => {
  const svc = buildService('agentistics', EN.svcAgentistics, [NATIVE_DOWN, MACHINE_DOWN], EN)
  const [fg, bg, dockerFg, dockerBg] = svc.startOptions

  // Both runtimes bind the same host ports (native directly, the container via host networking),
  // so every option here would collide with a `local` that came up in the meantime.
  expect(fg!.blockedBy).toBe('local')
  expect(bg!.blockedBy).toBe('local')
  expect(dockerFg!.blockedBy).toBe('local')
  expect(dockerBg!.blockedBy).toBe('local')

  // The consent gate belongs to the process that will be writing history here — the CLI itself
  // for the native runtime, the containerized server (never this CLI) for the Docker one.
  expect([fg!.asksArchive, bg!.asksArchive]).toEqual([true, true])
  expect(dockerFg!.asksArchive).toBeUndefined()
  expect(dockerBg!.asksArchive).toBeUndefined()

  // Only a DETACHED option is worth a boot unit, and only where a real mechanism exists — which is
  // now true for both runtimes: `local` background installs `agentop-server`, `machine` background
  // installs `agentop-machine`. Neither foreground offers it: both hold this session's terminal
  // (directly, or under `suspend` until Ctrl-C) rather than outliving it.
  expect(bg!.offersBoot).toBe(true)
  expect(dockerBg!.offersBoot).toBe(true)
  expect(fg!.offersBoot).toBeUndefined()
  expect(dockerFg!.offersBoot).toBeUndefined()
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

// -- the restarts, and the rebuild that must not be offered where it cannot work ----------------

test('a stopped service offers no restart at all — the mirror of a running one offering no start', () => {
  const svc = buildService('agentistics', EN.svcAgentistics, [NATIVE_DOWN, MACHINE_DOWN], EN, {
    // Everything a rebuild needs is here; there is simply nothing running to restart.
    rebuild: { local: true, machine: true },
  })
  expect(svc.restartOptions).toEqual([])
})

test('a running service offers the plain bounce and, where possible, a rebuild', () => {
  const svc = buildService('agentistics', EN.svcAgentistics, [NATIVE_UP, MACHINE_DOWN], EN, {
    rebuild: { local: true },
  })
  expect(svc.restartOptions).toEqual([
    { target: 'agentistics', rebuild: false, label: EN.optRestart, hint: EN.optRestartHint },
    { target: 'agentistics', rebuild: true, label: EN.optRebuild, hint: EN.optRebuildNativeHint },
  ])
})

// The rule this exists for: `bun run bin` needs the repo checkout and the machine's rebuild needs
// its compose file. Offering a verb that fails on principle is worse than not offering it, because
// the user pressed it on the screen's word.
test('without the pieces a rebuild needs, the rebuild is ABSENT rather than offered and failing', () => {
  const svc = buildService('agentistics', EN.svcAgentistics, [NATIVE_UP, MACHINE_DOWN], EN)
  expect(svc.restartOptions.map(o => o.rebuild)).toEqual([false])
  expect(svc.restartOptions.map(o => o.label)).toEqual([EN.optRestart])
})

// A rebuild is only offered for what is RUNNING: the machine container can be rebuilt on this box,
// but rebuilding a container that is down is a start, and the start options are where that lives.
test('a rebuild is offered per RUNNING runtime, not per runtime that could rebuild', () => {
  const svc = buildService('agentistics', EN.svcAgentistics, [NATIVE_UP, MACHINE_DOWN], EN, {
    rebuild: { local: false, machine: true },
  })
  expect(svc.restartOptions.map(o => o.rebuild)).toEqual([false])
})

// "Rebuild it" has no single meaning while the same program is running twice — and rebuilding both
// would leave the conflict exactly where it was. Same shape as the per-runtime stops beside them.
test('a conflict names the runtime each rebuild acts on', () => {
  const svc = buildService('agentistics', EN.svcAgentistics, [NATIVE_UP, MACHINE_UP], EN, {
    rebuild: { local: true, machine: true },
  })
  expect(svc.restartOptions).toEqual([
    { target: 'agentistics', rebuild: false, label: EN.optRestart, hint: EN.optRestartHint },
    { target: 'local', rebuild: true, label: 'Rebuild & restart (native)', hint: EN.optRebuildNativeHint },
    { target: 'machine', rebuild: true, label: 'Rebuild & restart (docker)', hint: EN.optRebuildDockerHint },
  ])
})

test('the restarts are localized, and a container says what a rebuild means for a container', () => {
  const svc = buildService('central', PT.svcCentral, [runtime({ id: 'central', state: 'up' })], PT, {
    rebuild: { central: true },
  })
  expect(svc.restartOptions.map(o => o.label)).toEqual(['Reiniciar', 'Reconstruir & reiniciar'])
  expect(svc.restartOptions[1]!.hint).toBe(PT.optRebuildDockerHint)
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
    'Iniciar (neste terminal)', 'Iniciar (background)',
    'Iniciar (docker, neste terminal)', 'Iniciar (docker, background)',
  ])
})

test('an undetectable service still says why, and is still startable', () => {
  const svc = buildService('agentistics', EN.svcAgentistics, [NATIVE_DOWN, MACHINE_BLIND], EN)
  expect(svc.state).toBe('unknown')
  expect(svc.reason).toBe(EN.dockerUnreachable)
  expect(svc.startOptions.map(o => o.runtime)).toEqual<RuntimeId[]>(['local', 'local', 'machine', 'machine'])
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

// ---------------------------------------------------------------------------
// the fleet the Sessions tab draws
// ---------------------------------------------------------------------------
//
// `sessionSnapshot` is the composition behind `ControlHost.sessions()`: the registry, the backend,
// `/proc` and one captured frame per RUNNING session. Its two rules are that it never reports an
// empty list it cannot stand behind, and that it never captures a pane it does not need to read.

const backendOf = (over: Partial<SessionBackend> = {}): SessionBackend => ({
  id: 'tmux',
  unavailable: async () => undefined,
  spawn: async () => {},
  list: async () => [],
  capture: async () => ({ ok: true, lines: [] }),
  kill: async () => true,
  attachCommand: () => [],
  detachHint: async () => 'Ctrl-b then d',
  ...over,
})

const managedOf = (id: string): ManagedSession =>
  ({ id, harness: 'claude', cwd: `/home/u/${id}`, createdAt: '2026-08-12T10:00:00.000Z' })

const hostedOf = (id: string, alive: boolean): BackendSession =>
  ({ id, createdMs: 1_000, attached: false, alive, lastActivityMs: 1_000 })

// An empty list rendered as "nothing is running" is a confident zero: the truth on a box without
// tmux is that nothing could be LOOKED at. This is the one case the whole record shape exists for.
test('a backend that cannot run here yields a REASON, never a bare empty list', async () => {
  const snapshot = await sessionSnapshot(
    backendOf({ unavailable: async () => 'tmux is not installed — install it to manage background sessions' }),
    EN,
  )
  expect(snapshot.views).toEqual([])
  expect(snapshot.unavailable).toBe(EN.sessionsNoTmux)
})

// The backend is a platform module with no language of its own, and this screen speaks the user's.
test('the unavailable reason is the HOST language, not the backend own English', async () => {
  const snapshot = await sessionSnapshot(backendOf({ unavailable: async () => 'tmux is not installed' }), PT)
  expect(snapshot.unavailable).toBe(PT.sessionsNoTmux)
  expect(snapshot.unavailable).not.toBe('tmux is not installed')
})

// A backend the table has no sentence for keeps its own words — the truest thing available — rather
// than being silently reported as available, or as tmux.
test('a backend this table cannot translate keeps its own reason', async () => {
  const snapshot = await sessionSnapshot(
    backendOf({ id: 'pty', unavailable: async () => 'the pty backend is not implemented yet' }),
    EN,
  )
  expect(snapshot.unavailable).toBe('the pty backend is not implemented yet')
})

// A capture is a tmux process, run for every session on a five-second timer — the one place this
// feature can get expensive. A `lost` session has no pane at all and an `exited` one's last frame
// cannot change what the view already knows, so neither is read.
test('only RUNNING sessions are captured, and only the 40 lines the classifier was written for', async () => {
  const asked: Array<[string, number]> = []
  const snapshot = await sessionSnapshot(
    backendOf({
      list: async () => [hostedOf('running1', true), hostedOf('exited1', false)],
      capture: async (id, lines) => { asked.push([id, lines]); return { ok: true, lines: [] } },
    }),
    EN,
    {
      // 'lost1' is in the registry and not in the backend; 'exited1' is hosted but finished.
      registry: async () => [managedOf('running1'), managedOf('exited1'), managedOf('lost1')],
      processes: async () => [],
      nowMs: () => 1_000_000,
    },
  )
  expect(asked).toEqual([['running1', 40]])
  expect(snapshot.unavailable).toBeUndefined()
  expect(snapshot.views.map(v => v.id).sort()).toEqual(['exited1', 'lost1', 'running1'])
})

// `reconcileSessions` marks a row `unregistered` when the backend hosts it but the registry never
// knew it (a crash between `backend.spawn` and `addSession`, or a wiped registry with tmux still
// up) — and such a row can carry a real `backend.alive === true`, which `buildSessionViews`
// classifies exactly like a registered running session (see monitor.ts's comment on `status` vs
// `alive`). The capture filter has to agree with that classifier's predicate, or an unregistered
// session sitting on a live approval prompt gets no capture at all, `monitor.ts` substitutes an
// empty `{ ok: true, lines: [] }`, and the classifier reads that as an ordinary quiet frame —
// `idle-unknown` for a session that may need the user right now.
test('an unregistered-but-alive session is still captured, not silently skipped', async () => {
  const asked: string[] = []
  const snapshot = await sessionSnapshot(
    backendOf({
      list: async () => [hostedOf('orphan1', true)],
      capture: async id => { asked.push(id); return { ok: true, lines: [] } },
    }),
    EN,
    {
      // Absent from the registry entirely, so `reconcileSessions` marks it 'unregistered' — not
      // 'running' — while `backend.alive` for it is true.
      registry: async () => [],
      processes: async () => [],
      nowMs: () => 1_000_000,
    },
  )
  expect(asked).toEqual(['orphan1'])
})

// A rejected capture must not cost the rest of the fleet their real states. `unreadable` exists
// precisely to say this about ONE row; a bare `Promise.all` over the captures turned any single
// rejection into `sessionsReadFailed` for every session, which is the same over-claiming as the
// unregistered-row bug above, just from the other side of the same predicate.
test('one rejecting capture does not take the rest of the fleet down with it', async () => {
  const snapshot = await sessionSnapshot(
    backendOf({
      list: async () => [hostedOf('ok1', true), hostedOf('bad1', true)],
      capture: async id => {
        if (id === 'bad1') throw new Error('tmux capture-pane failed')
        return { ok: true, lines: [] }
      },
    }),
    EN,
    {
      registry: async () => [managedOf('ok1'), managedOf('bad1')],
      processes: async () => [],
      nowMs: () => 1_000_000,
    },
  )
  expect(snapshot.unavailable).toBeUndefined()
  expect(snapshot.views.find(v => v.id === 'bad1')?.state).toBe('unreadable')
  expect(snapshot.views.find(v => v.id === 'ok1')?.state).not.toBe('unreadable')
})

// The screen POLLS this, outside the shell's action wrapper that turns a throw into a message — so
// a rejection here would take the control center down. It must degrade, and it must degrade into
// "the list is unknown" rather than "the list is empty".
test('a composition that fails says so instead of reporting an empty fleet', async () => {
  const snapshot = await sessionSnapshot(backendOf(), EN, {
    registry: async () => { throw new Error('registry on fire') },
    processes: async () => [],
  })
  expect(snapshot.views).toEqual([])
  expect(snapshot.unavailable).toBe(EN.sessionsReadFailed)
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
