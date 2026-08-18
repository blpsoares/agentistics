import { test, expect } from 'bun:test'
import {
  SERVICE_MANAGERS,
  availableServiceManagers,
  bootCaveat,
  defaultServiceManager,
  launchdLabel,
  launchdPlist,
  launchdPlistName,
  pm2DeleteArgs,
  pm2StartArgs,
  serviceManagerOptions,
  systemdUnit,
  type ServiceManagerFacts,
  type ServiceSpec,
} from './service-manager'

function facts(over: Partial<ServiceManagerFacts> = {}): ServiceManagerFacts {
  return { platform: 'linux', systemctl: true, launchctl: false, pm2: false, ...over }
}

const FOREGROUND: ServiceSpec = {
  name: 'agentop-server',
  description: 'agentop server (agentistics autostart)',
  command: '/usr/local/bin/agentop server',
  keepsRunning: true,
}

const RETURNS: ServiceSpec = {
  name: 'agentop-central',
  description: 'agentop central (agentistics autostart)',
  command: 'docker compose -f /home/u/agentistics/docker/central.yml up -d',
  keepsRunning: false,
}

test('each platform offers its own manager and refuses the other by platform, not by absence', () => {
  const linux = serviceManagerOptions(facts({ platform: 'linux', launchctl: true }))
  expect(linux.find(o => o.id === 'launchd')).toEqual({ id: 'launchd', available: false, reason: 'wrong-platform' })

  const mac = serviceManagerOptions(facts({ platform: 'darwin', systemctl: true, launchctl: true }))
  expect(mac.find(o => o.id === 'systemd')).toEqual({ id: 'systemd', available: false, reason: 'wrong-platform' })
  expect(mac.find(o => o.id === 'launchd')?.available).toBe(true)
})

test('the right platform with the tool missing is not-installed, which is a different fix', () => {
  const opt = serviceManagerOptions(facts({ platform: 'linux', systemctl: false })).find(o => o.id === 'systemd')
  expect(opt).toEqual({ id: 'systemd', available: false, reason: 'not-installed' })
})

// pm2 is the answer on a host whose init system this product does not speak, so it must never be
// refused on platform — that is precisely the case where it is the only option left.
test('pm2 is offered on any platform, gated only on being installed', () => {
  for (const platform of ['linux', 'darwin', 'win32', 'freebsd']) {
    expect(availableServiceManagers(facts({ platform, systemctl: false, launchctl: false, pm2: true })))
      .toContain('pm2')
    expect(serviceManagerOptions(facts({ platform, pm2: false })).find(o => o.id === 'pm2')?.reason)
      .toBe('not-installed')
  }
})

// Filing agentop into someone's pm2 list is their decision: it shows up in every `pm2 ls` and is
// caught by `pm2 restart all`.
test('pm2 never wins by default while a native manager is available', () => {
  expect(defaultServiceManager(facts({ platform: 'linux', systemctl: true, pm2: true }))).toBe('systemd')
  expect(defaultServiceManager(facts({ platform: 'darwin', systemctl: false, launchctl: true, pm2: true }))).toBe('launchd')
  expect(defaultServiceManager(facts({ platform: 'darwin', launchctl: false, pm2: true }))).toBe('pm2')
  expect(defaultServiceManager(facts({ platform: 'win32', systemctl: false, pm2: false }))).toBeNull()
})

// THE bug this module exists for: a command that returns cannot be Type=simple, or the unit reads
// inactive(dead) one second after a perfectly successful start.
test('a returning command becomes a oneshot that stays active; a foreground one stays simple', () => {
  const oneshot = systemdUnit(RETURNS)
  expect(oneshot).toContain('Type=oneshot')
  expect(oneshot).toContain('RemainAfterExit=yes')
  expect(oneshot).not.toContain('Restart=on-failure')

  const simple = systemdUnit(FOREGROUND)
  expect(simple).toContain('Type=simple')
  expect(simple).toContain('Restart=on-failure')
  expect(simple).not.toContain('RemainAfterExit')
})

test('the same distinction drives launchd KeepAlive and pm2 autorestart', () => {
  const paths = { stdoutPath: '/tmp/a.log', stderrPath: '/tmp/a.err' }
  expect(launchdPlist(FOREGROUND, paths)).toContain('<key>KeepAlive</key>\n  <true/>')
  expect(launchdPlist(RETURNS, paths)).toContain('<key>KeepAlive</key>\n  <false/>')

  expect(pm2StartArgs(RETURNS)).toContain('--no-autorestart')
  expect(pm2StartArgs(FOREGROUND)).not.toContain('--no-autorestart')
})

test('a launchd agent is labelled and named consistently', () => {
  expect(launchdLabel(RETURNS)).toBe('com.agentistics.agentop-central')
  expect(launchdPlistName(RETURNS)).toBe('com.agentistics.agentop-central.plist')
})

test('pm2 delete is the exact inverse of pm2 start', () => {
  expect(pm2DeleteArgs(RETURNS)).toEqual(['pm2', 'delete', 'agentop-central'])
  expect(pm2StartArgs(RETURNS).slice(0, 2)).toEqual(['pm2', 'start'])
  expect(pm2StartArgs(RETURNS)).toContain(RETURNS.name)
})

// A plist is XML: a command holding an ampersand or a quote must not be able to produce a file
// launchd refuses to parse.
test('plist values are XML-escaped', () => {
  const spec: ServiceSpec = { ...RETURNS, command: 'sh -c "a && b" </dev/null' }
  const out = launchdPlist(spec, { stdoutPath: '/tmp/a&b.log', stderrPath: '/tmp/e.err' })
  expect(out).toContain('a &amp;&amp; b')
  expect(out).toContain('&lt;/dev/null')
  expect(out).toContain('/tmp/a&amp;b.log')
  expect(out).not.toMatch(/<string>[^<]*"[^<]*<\/string>/)
})

test('every manager states what the user must still do for a reboot to bring it back', () => {
  const seen = new Set(SERVICE_MANAGERS.map(bootCaveat))
  expect(seen).toEqual(new Set(['linger', 'login-only', 'pm2-startup']))
})
