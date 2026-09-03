import { test, expect } from 'bun:test'
import {
  resolveUpgradeAsset,
  releaseAssetName,
  releaseAssetUrl,
  releaseTag,
  downloadUpgradeAsset,
  downloadFailureMessage,
  downloadFailureReason,
  verifyDownload,
  looksLikeExecutable,
  checkBinaryVersionOutput,
  tempBinaryPath,
  backupBinaryPath,
  parseUpgradeFailure,
  nextUpgradeFailure,
  shouldAttemptUpgrade,
  upgradeBackoffMs,
  UPGRADE_BACKOFF_STEPS_MS,
  MIN_BINARY_BYTES,
  type UpgradeTarget,
} from './upgrade'
import { cliStrings } from './cli-i18n'
import { resolveLatestRelease } from './version'

// --- platform/arch gate -----------------------------------------------------
// .github/workflows/release.yml publishes exactly two compiled assets: `agentop`
// (ubuntu-latest → linux x64) and `agentop.exe` (--target=bun-windows-x64). Anything
// else must be refused BEFORE a byte is downloaded — installing the x86_64 ELF on an
// arm64 box replaces a working binary with one the kernel cannot exec.

test('only the platform/arch pairs the release workflow publishes are self-installable', () => {
  expect(resolveUpgradeAsset('linux', 'x64', '2.5.0')).toEqual({
    asset: 'agentop',
    url: 'https://github.com/blpsoares/agentistics/releases/download/v2.5.0/agentop',
    version: '2.5.0',
  })
  expect(resolveUpgradeAsset('win32', 'x64', '2.5.0')).toEqual({
    asset: 'agentop.exe',
    url: 'https://github.com/blpsoares/agentistics/releases/download/v2.5.0/agentop.exe',
    version: '2.5.0',
  })
})

test('unsupported platform/arch combinations are refused', () => {
  expect(resolveUpgradeAsset('linux', 'arm64', '2.5.0')).toBeNull()   // Raspberry Pi / Ampere VM
  expect(resolveUpgradeAsset('linux', 'arm', '2.5.0')).toBeNull()
  expect(resolveUpgradeAsset('darwin', 'arm64', '2.5.0')).toBeNull()  // no macOS asset at all
  expect(resolveUpgradeAsset('darwin', 'x64', '2.5.0')).toBeNull()
  expect(resolveUpgradeAsset('win32', 'arm64', '2.5.0')).toBeNull()
  expect(resolveUpgradeAsset('freebsd', 'x64', '2.5.0')).toBeNull()
  // The gate is answerable WITHOUT a version — that is why the asset name is its own function.
  expect(releaseAssetName('linux', 'arm64')).toBeNull()
  expect(releaseAssetName('linux', 'x64')).toBe('agentop')
})

// --- the address is the RESOLVED VERSION, never GitHub's "Latest" flag -------
// 2026-09-02 13:57 UTC: the extension's `vscode-v1.0.0` release (a `.vsix` and nothing else) was
// published, took the "Latest" flag, and `/releases/latest/download/agentop` began answering 404
// on every machine — while v2.5.0's binary sat published and intact. The two notions of "latest"
// disagreed, and the download was reading the movable one.

test('a release tag is normalized whether or not the version carries its v', () => {
  expect(releaseTag('2.5.0')).toBe('v2.5.0')
  expect(releaseTag('v2.5.0')).toBe('v2.5.0')
  expect(releaseTag(' 2.5.0 ')).toBe('v2.5.0')
  expect(releaseAssetUrl('v2.5.0', 'agentop'))
    .toBe('https://github.com/blpsoares/agentistics/releases/download/v2.5.0/agentop')
})

test('no download URL is derived from the movable `latest` alias', () => {
  for (const version of ['2.5.0', 'v2.5.0', '10.0.1']) {
    for (const [platformId, arch] of [['linux', 'x64'], ['win32', 'x64']] as const) {
      const target = resolveUpgradeAsset(platformId, arch, version)!
      expect(target.url).not.toContain('releases/latest/download')
      expect(target.url).toContain(`/releases/download/${releaseTag(version)}/`)
    }
  }
})

test('the release flagged "Latest" holding no agentop asset does not move the download', async () => {
  // The releases API answer as it stood during the incident: the extension release was published
  // most recently (so GitHub flags it "Latest") and carries no binary; v2.5.0 is the real newest
  // agentop. `resolveLatestRelease` — what `getVersionInfo()` runs — ignores the non-semver tag.
  const releases = [
    { tag_name: 'vscode-v1.0.0', body: 'VS Code extension' },
    { tag_name: 'v2.5.0', body: '' },
    { tag_name: 'v2.4.0', body: '' },
  ]
  const resolved = resolveLatestRelease(releases, '2.4.0')
  expect(resolved.latest).toBe('2.5.0')
  expect(resolved.hasUpdate).toBe(true)

  // The download must address THAT version — the fact the command already had in hand.
  const target = resolveUpgradeAsset('linux', 'x64', resolved.latest)!
  const asked: string[] = []
  const spy = (async (url: any) => {
    asked.push(String(url))
    // Only the version-addressed URL carries the binary; the "latest" alias is the 404 of the incident.
    if (String(url).includes('releases/latest/download')) {
      return new Response('Not Found', { status: 404 })
    }
    return new Response(new Uint8Array([0x7f, 0x45, 0x4c, 0x46]))
  }) as unknown as typeof fetch

  const result = await downloadUpgradeAsset(target, spy)
  expect(asked).toEqual(['https://github.com/blpsoares/agentistics/releases/download/v2.5.0/agentop'])
  expect(result.ok).toBe(true)
  expect(result.ok === true && Array.from(result.bytes)).toEqual([0x7f, 0x45, 0x4c, 0x46])
})

test('the module holds no `latest` download alias for either path to pick up again', async () => {
  const src = await Bun.file(new URL('./upgrade.ts', import.meta.url)).text()
  // Comments are stripped: the alias is NAMED in the prose that records the incident, and a trap
  // that forbade writing it down would forbid explaining it. What must not come back is the CODE.
  const code = src
    .split('\n')
    .filter(line => !/^\s*(\/\/|\/?\*)/.test(line))
    .join('\n')
  // RELEASES_PAGE (`/releases`) is a page for a PERSON and stays; the download ALIAS may not
  // reappear — the manual path and the automatic one both take their address from this module.
  expect(code).not.toContain('releases/latest/download')
  // And there is exactly ONE place a download URL is built, so the two paths cannot diverge.
  expect(code.split('/releases/download/').length - 1).toBe(1)
})

// --- a missing asset and a broken network are different sentences ------------

const linuxTarget = (): UpgradeTarget => resolveUpgradeAsset('linux', 'x64', '2.5.0')!

test('a 404 is reported as that version lacking the asset, never as a bare HTTP code', async () => {
  const spy = (async () => new Response('Not Found', { status: 404 })) as unknown as typeof fetch
  const result = await downloadUpgradeAsset(linuxTarget(), spy)
  expect(result).toEqual({ ok: false, kind: 'missing-asset', status: 404 })

  const target = linuxTarget()
  const msg = downloadFailureMessage(result as any, target, cliStrings('en'))
  expect(msg).toContain('v2.5.0')
  expect(msg).toContain('agentop')
  expect(msg).toContain(target.url)
  // A person reading only this line must not conclude their connection failed.
  expect(msg).toContain('network is fine')
  expect(downloadFailureReason(result as any, target)).toBe('release v2.5.0 has no agentop asset (HTTP 404)')

  const pt = downloadFailureMessage(result as any, target, cliStrings('pt'))
  expect(pt).toContain('não tem o anexo agentop')
})

test('a network failure says so, and is not dressed up as a missing asset', async () => {
  const spy = (async () => { throw new Error('The operation timed out') }) as unknown as typeof fetch
  const result = await downloadUpgradeAsset(linuxTarget(), spy)
  expect(result).toEqual({ ok: false, kind: 'network', message: 'The operation timed out' })

  const msg = downloadFailureMessage(result as any, linuxTarget(), cliStrings('en'))
  expect(msg).toContain('The operation timed out')
  expect(msg).toContain('network failure')
  expect(msg).not.toContain('does not carry')
  expect(downloadFailureReason(result as any, linuxTarget())).toBe('download failed: The operation timed out')
})

test('a non-404 HTTP answer is neither of the two — it keeps its status', async () => {
  const spy = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch
  const result = await downloadUpgradeAsset(linuxTarget(), spy)
  expect(result).toEqual({ ok: false, kind: 'http', status: 503 })
  expect(downloadFailureMessage(result as any, linuxTarget(), cliStrings('en'))).toContain('HTTP 503')
  expect(downloadFailureReason(result as any, linuxTarget())).toBe('download failed: HTTP 503')
})

// --- download verification --------------------------------------------------

const elfHead = () => new Uint8Array([0x7f, 0x45, 0x4c, 0x46])
const peHead = () => new Uint8Array([0x4d, 0x5a, 0x90, 0x00])

function payload(head: Uint8Array, size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set(head, 0)
  return bytes
}

test('executable magic is checked per platform', () => {
  expect(looksLikeExecutable(elfHead(), 'linux')).toBe(true)
  expect(looksLikeExecutable(peHead(), 'win32')).toBe(true)
  expect(looksLikeExecutable(peHead(), 'linux')).toBe(false)   // Windows PE on Linux
  expect(looksLikeExecutable(elfHead(), 'win32')).toBe(false)
  // "<!DOCTYPE" — a GitHub error/redirect page, the classic 200-with-HTML case.
  expect(looksLikeExecutable(new Uint8Array([0x3c, 0x21, 0x44, 0x4f]), 'linux')).toBe(false)
})

test('verifyDownload rejects truncated payloads and non-executables', () => {
  expect(verifyDownload(payload(elfHead(), MIN_BINARY_BYTES + 1), 'linux')).toEqual({ ok: true })

  const short = verifyDownload(payload(elfHead(), 1024), 'linux')
  expect(short.ok).toBe(false)
  expect(short.ok === false && short.reason).toContain('1024 bytes')

  const html = verifyDownload(payload(new Uint8Array([0x3c, 0x21, 0x44, 0x4f]), MIN_BINARY_BYTES + 1), 'linux')
  expect(html.ok).toBe(false)
  expect(html.ok === false && html.reason).toContain('not an executable')

  // Empty body (dropped connection) never reaches the disk swap.
  expect(verifyDownload(new Uint8Array(0), 'linux').ok).toBe(false)
})

// --- post-download identity check -------------------------------------------

test('the downloaded binary must identify itself as the expected version (or newer)', () => {
  expect(checkBinaryVersionOutput('agentop v1.7.0\n', '1.7.0')).toEqual({ ok: true, found: '1.7.0' })
  // A release whose asset was compiled from a later commit reports the higher number — newer is
  // fine, older is not: that is the direction this check exists to catch.
  expect(checkBinaryVersionOutput('agentop v1.7.1\n', '1.7.0')).toEqual({ ok: true, found: '1.7.1' })
  expect(checkBinaryVersionOutput('agentop v1.6.9\n', '1.7.0')).toEqual({ ok: false, found: '1.6.9' })
  // Nothing usable printed → the file did not run (wrong arch, corrupt, killed).
  expect(checkBinaryVersionOutput('', '1.7.0')).toEqual({ ok: false, found: null })
  expect(checkBinaryVersionOutput('bash: cannot execute binary file', '1.7.0')).toEqual({ ok: false, found: null })
  expect(checkBinaryVersionOutput('<!DOCTYPE html>', '1.7.0')).toEqual({ ok: false, found: null })
})

// --- atomic staging paths ---------------------------------------------------

test('the staged file is unique, hidden and next to the binary it will replace', () => {
  // Same directory → rename() is atomic (a cross-filesystem move is a copy, i.e. a window
  // where the live binary is half-written).
  expect(tempBinaryPath('/home/u/.local/bin/agentop', 'abc123'))
    .toBe('/home/u/.local/bin/.agentop.new-abc123')
  // The extension survives, or Windows cannot exec the staged file to verify it.
  expect(tempBinaryPath('/opt/tools/agentop.exe', 'deadbeef'))
    .toBe('/opt/tools/.agentop.new-deadbeef.exe')
  // Two concurrent upgrades never collide on the same temp name.
  expect(tempBinaryPath('/bin/agentop', 'a')).not.toBe(tempBinaryPath('/bin/agentop', 'b'))
})

test('the replaced binary is kept next to the target for rollback', () => {
  expect(backupBinaryPath('/home/u/.local/bin/agentop')).toBe('/home/u/.local/bin/agentop.bak')
  expect(backupBinaryPath('/opt/tools/agentop.exe')).toBe('/opt/tools/agentop.exe.bak')
})

// --- failure memory + backoff ----------------------------------------------

test('parseUpgradeFailure accepts a valid state and rejects junk', () => {
  expect(parseUpgradeFailure('{"version":"1.7.0","failedAt":1000,"attempts":2,"reason":"HTTP 404"}'))
    .toEqual({ version: '1.7.0', failedAt: 1000, attempts: 2, reason: 'HTTP 404' })
  expect(parseUpgradeFailure('{"version":"1.7.0","failedAt":1000}'))
    .toEqual({ version: '1.7.0', failedAt: 1000, attempts: 1, reason: '' })
  expect(parseUpgradeFailure('not json')).toBeNull()
  expect(parseUpgradeFailure('{"failedAt":1000}')).toBeNull()          // no version
  expect(parseUpgradeFailure('{"version":"1.7.0"}')).toBeNull()        // no timestamp
})

test('backoff widens with consecutive failures and caps', () => {
  expect(upgradeBackoffMs(1)).toBe(UPGRADE_BACKOFF_STEPS_MS[0]!)
  expect(upgradeBackoffMs(2)).toBe(UPGRADE_BACKOFF_STEPS_MS[1]!)
  expect(upgradeBackoffMs(4)).toBe(UPGRADE_BACKOFF_STEPS_MS[3]!)
  expect(upgradeBackoffMs(99)).toBe(UPGRADE_BACKOFF_STEPS_MS[3]!)      // capped, never grows forever
  expect(upgradeBackoffMs(0)).toBe(UPGRADE_BACKOFF_STEPS_MS[0]!)       // defensive
})

test('consecutive failures on the same version increment; a new version resets', () => {
  const first = nextUpgradeFailure(null, '1.7.0', 1000, 'HTTP 404')
  expect(first).toEqual({ version: '1.7.0', failedAt: 1000, attempts: 1, reason: 'HTTP 404' })
  const second = nextUpgradeFailure(first, '1.7.0', 2000, 'HTTP 404')
  expect(second.attempts).toBe(2)
  // A newer release may well fix whatever failed — it gets a clean slate.
  expect(nextUpgradeFailure(second, '1.7.1', 3000, 'HTTP 404').attempts).toBe(1)
})

test('a permanently failing update backs off instead of re-downloading on every shell', () => {
  const t0 = 1_000_000
  const state = { version: '1.7.0', failedAt: t0, attempts: 1, reason: 'permission denied' }
  expect(shouldAttemptUpgrade(state, '1.7.0', t0 + 1000)).toBe(false)                       // seconds later
  expect(shouldAttemptUpgrade(state, '1.7.0', t0 + upgradeBackoffMs(1) - 1)).toBe(false)
  expect(shouldAttemptUpgrade(state, '1.7.0', t0 + upgradeBackoffMs(1))).toBe(true)         // window elapsed
  // A different target version is always retried immediately.
  expect(shouldAttemptUpgrade(state, '1.7.1', t0 + 1000)).toBe(true)
  // Nothing recorded → always allowed.
  expect(shouldAttemptUpgrade(null, '1.7.0', t0)).toBe(true)
  // After 4 failures the wait is a full day, not another 140 MB download per terminal.
  const worn = { ...state, attempts: 4 }
  expect(shouldAttemptUpgrade(worn, '1.7.0', t0 + 8 * 60 * 60_000)).toBe(false)
  expect(shouldAttemptUpgrade(worn, '1.7.0', t0 + 24 * 60 * 60_000)).toBe(true)
})
