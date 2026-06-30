import { existsSync } from 'node:fs'
import path from 'node:path'

const HOME = process.env.HOME ?? process.env.USERPROFILE ?? ''

/**
 * Robustly detect whether a CLI binary is installed.
 *
 * The Nay backend spawns these CLIs to generate chat responses, so detection
 * must not rely solely on the server process's PATH — when the server runs as a
 * background/sidecar process the PATH is often stripped of user bin dirs
 * (~/.local/bin, ~/.bun/bin, npm global prefix), which made installed CLIs read
 * as "not installed". Check the common install locations directly, then fall
 * back to `which` with an augmented PATH.
 *
 * Note: this only detects CLIs runnable by the *server process*. The desktop app
 * runs its sidecar on Windows; CLIs installed inside WSL are not executable from
 * Windows and will (correctly) read as unavailable there.
 */
export function findCli(name: string): boolean {
  const candidates = [
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    path.join(HOME, '.local', 'bin', name),
    path.join(HOME, '.bun', 'bin', name),
    path.join(HOME, '.npm-global', 'bin', name),
    path.join(HOME, '.npm', 'bin', name),
    path.join(HOME, 'node_modules', '.bin', name),
    // Windows global npm install location
    path.join(process.env.APPDATA ?? '', 'npm', `${name}.cmd`),
    path.join(process.env.APPDATA ?? '', 'npm', `${name}.exe`),
  ]
  if (candidates.some(p => p && existsSync(p))) return true

  const augmentedPath = [
    process.env.PATH ?? '',
    path.join(HOME, '.local', 'bin'),
    path.join(HOME, '.bun', 'bin'),
    path.join(HOME, '.npm-global', 'bin'),
  ].filter(Boolean).join(path.delimiter)

  try {
    // `which` on POSIX, `where` on Windows.
    const cmd = process.platform === 'win32' ? ['where', name] : ['which', name]
    const proc = Bun.spawnSync(cmd, {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PATH: augmentedPath },
    })
    return proc.exitCode === 0
  } catch {
    return false
  }
}
