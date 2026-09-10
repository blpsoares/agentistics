import { test, expect } from 'bun:test'
import { parseBackupArgs, readBackupPrefs } from '../cli-backup'

test('`github install-workflow` parses with no arguments — it uses the stored config', () => {
  expect(parseBackupArgs(['github', 'install-workflow'])).toEqual({ kind: 'github-install-workflow' })
})

test('`github` with an unknown subcommand names every valid one', () => {
  const a = parseBackupArgs(['github', 'bogus'])
  expect(a.kind).toBe('error')
  if (a.kind !== 'error') return
  expect(a.message).toContain('install-workflow')
})

test('bare `agentop backup` runs with the default layers and every harness', () => {
  const a = parseBackupArgs([])
  expect(a.kind).toBe('run')
  if (a.kind !== 'run') return
  expect(a.layers).toEqual(['metrics', 'repos'])
  expect(a.harnesses.length).toBeGreaterThan(0)
})

test('layers are opt-in and additive', () => {
  const a = parseBackupArgs(['--with-archive', '--with-raw'])
  if (a.kind !== 'run') throw new Error('expected run')
  expect(a.layers).toEqual(['metrics', 'repos', 'archive', 'raw'])
})

test('a harness selection narrows, and an unknown harness is a usage error', () => {
  const a = parseBackupArgs(['--harness', 'claude,codex'])
  if (a.kind !== 'run') throw new Error('expected run')
  expect(a.harnesses).toEqual(['claude', 'codex'])

  const bad = parseBackupArgs(['--harness', 'gpt'])
  expect(bad.kind).toBe('error')
})

test('`--plan` asks for the plan and nothing else', () => {
  const a = parseBackupArgs(['--plan'])
  if (a.kind !== 'run') throw new Error('expected run')
  expect(a.planOnly).toBe(true)
})

test('--max-bundle takes megabytes, and refuses anything that is not a positive number', () => {
  const a = parseBackupArgs(['--max-bundle', '50'])
  if (a.kind !== 'run') throw new Error('expected run')
  expect(a.maxBundleBytes).toBe(50 * 1024 * 1024)
  expect(parseBackupArgs(['--max-bundle', 'big']).kind).toBe('error')
  expect(parseBackupArgs(['--max-bundle', '0']).kind).toBe('error')
})

// A preference that is read and never consulted is worse than no preference: the user sets it,
// nothing changes, and they are left guessing which of the two they got wrong.
test('a --with flag marks the layers explicit; without one they come from configuration', () => {
  const bare = parseBackupArgs([])
  if (bare.kind !== 'run') throw new Error('expected run')
  expect(bare.layersFromFlags).toBe(false)

  const flagged = parseBackupArgs(['--with-raw'])
  if (flagged.kind !== 'run') throw new Error('expected run')
  expect(flagged.layersFromFlags).toBe(true)
  expect(flagged.layers).toContain('raw')

  // A non-layer flag does not make the layers explicit.
  const other = parseBackupArgs(['--plan'])
  if (other.kind !== 'run') throw new Error('expected run')
  expect(other.layersFromFlags).toBe(false)
})

test('the schedule subcommand takes only the known ids', () => {
  expect(parseBackupArgs(['schedule', 'daily']).kind).toBe('schedule')
  expect(parseBackupArgs(['schedule', 'hourly']).kind).toBe('error')
})

// -----------------------------------------------------------------------------
// `agentop backup config` — everything the format/recurrence pickers can set from the CLI
// -----------------------------------------------------------------------------

test('`config` with no flags asks to print the current configuration', () => {
  const a = parseBackupArgs(['config'])
  expect(a).toEqual({ kind: 'config' })
})

test('`config --layers` parses a comma list into the closed layer set', () => {
  const a = parseBackupArgs(['config', '--layers', 'metrics,repos'])
  if (a.kind !== 'config') throw new Error('expected config')
  expect(a.layers).toEqual(['metrics', 'repos'])
  expect(a.schedule).toBeUndefined()
  expect(a.scheduleLayers).toBeUndefined()
})

test('`config --schedule-layers` is parsed independently of `--layers`', () => {
  const a = parseBackupArgs(['config', '--schedule-layers', 'metrics'])
  if (a.kind !== 'config') throw new Error('expected config')
  expect(a.scheduleLayers).toEqual(['metrics'])
  expect(a.layers).toBeUndefined()
})

test('`config` combines all three flags in one call', () => {
  const a = parseBackupArgs(['config', '--layers', 'metrics,repos', '--schedule', 'daily', '--schedule-layers', 'metrics'])
  if (a.kind !== 'config') throw new Error('expected config')
  expect(a.layers).toEqual(['metrics', 'repos'])
  expect(a.schedule).toBe('daily')
  expect(a.scheduleLayers).toEqual(['metrics'])
})

test('`config --layers` refuses an unknown layer, naming it and the closed set', () => {
  const a = parseBackupArgs(['config', '--layers', 'metrics,cloud'])
  expect(a.kind).toBe('error')
  if (a.kind !== 'error') return
  expect(a.message).toContain('cloud')
})

test('`config --schedule` refuses an id outside the closed schedule set', () => {
  expect(parseBackupArgs(['config', '--schedule', 'hourly']).kind).toBe('error')
})

test('an absent backup preference block yields safe defaults, not a crash', () => {
  const p = readBackupPrefs({})
  expect(p.schedule).toBe('off')
  expect(p.keep).toBeGreaterThan(0)
  expect(p.layers).toEqual(['metrics', 'repos'])
})

// A schedule that carried `raw` would be 2.4 GB per run. The default must not be able to become
// that by accident, so a stored preference is clamped on READ, the way sessionPollMs is.
test('a stored schedule that names `raw` is honoured, but the default never does', () => {
  expect(readBackupPrefs({ backup: { scheduleLayers: ['metrics', 'raw'] } } as never).scheduleLayers)
    .toEqual(['metrics', 'raw'])
  expect(readBackupPrefs({}).scheduleLayers).toEqual(['metrics', 'repos'])
})

// -----------------------------------------------------------------------------
// `--at` / `--days` — the grid anchor and the weekday filter, on `schedule` and `config`
// -----------------------------------------------------------------------------

test('`schedule custom` takes the hours right after it, and `--at`/`--days` anywhere after that', () => {
  const a = parseBackupArgs(['schedule', 'custom', '8', '--at', '9', '--days', 'mon,wed,fri'])
  if (a.kind !== 'schedule') throw new Error('expected schedule')
  expect(a.schedule).toBe('custom')
  expect(a.customHours).toBe(8)
  expect(a.atHour).toBe(9)
  expect(a.days).toEqual([1, 3, 5])
})

test('`schedule custom` with no hours still reads `--at`/`--days` (a flag never starts with a digit)', () => {
  const a = parseBackupArgs(['schedule', 'custom', '--at', '9'])
  if (a.kind !== 'schedule') throw new Error('expected schedule')
  expect(a.customHours).toBeUndefined()
  expect(a.atHour).toBe(9)
})

test('`--days` accepts weekday names, digits, or a mix, sorted and deduplicated', () => {
  const a = parseBackupArgs(['schedule', 'daily', '--days', 'fri,1,mon,1'])
  if (a.kind !== 'schedule') throw new Error('expected schedule')
  expect(a.days).toEqual([1, 5])
})

test('`--days` refuses an unknown token, naming it', () => {
  const a = parseBackupArgs(['schedule', 'daily', '--days', 'mon,someday'])
  expect(a.kind).toBe('error')
  if (a.kind !== 'error') return
  expect(a.message).toContain('someday')
})

test('`--at` refuses an hour outside 0-23', () => {
  expect(parseBackupArgs(['schedule', 'daily', '--at', '24']).kind).toBe('error')
  expect(parseBackupArgs(['schedule', 'daily', '--at', 'noon']).kind).toBe('error')
})

test('`config --at`/`--days` parse the same way as `schedule`\'s', () => {
  const a = parseBackupArgs(['config', '--at', '14', '--days', 'sat,sun'])
  if (a.kind !== 'config') throw new Error('expected config')
  expect(a.atHour).toBe(14)
  expect(a.days).toEqual([0, 6])
})

test('`readBackupPrefs` filters `days` to valid 0-6 integers rather than trusting a hand-edited file', () => {
  expect(readBackupPrefs({ backup: { days: [1, 3, 99, -1, 2.5] } } as never).days).toEqual([1, 3])
  expect(readBackupPrefs({}).days).toBeUndefined()
})
