/**
 * wsl-ports-io.ts — the IO boundary in front of the pure `wsl-ports.ts`.
 *
 * Two facts have to be read from the OS before the pure arithmetic can run: whether this process
 * is even inside WSL2, and — only then — which port ranges Windows currently excludes. Both are
 * READS, both are cheap, and both fail CLOSED: any error, timeout, or missing tool means "assume
 * nothing is wrong" rather than risking a startup that hangs or a port picked on a guess. This is
 * the same shape `repo-facts.ts` uses for "a directory that answers nothing is not a repository" —
 * an absent answer is a fact about the moment, not license to invent one.
 */
import { readFileSync } from 'node:fs'
import { findFreePortPair, parseExcludedRanges, portInAnyRange, type PortRange } from './wsl-ports'

/** True only when `/proc/version` names Microsoft's WSL kernel build. False on any read error —
 *  off Linux, in a container without `/proc`, or anywhere permission denies the read. */
export function isWSL(): boolean {
  try {
    return /microsoft/i.test(readFileSync('/proc/version', 'utf8'))
  } catch {
    return false
  }
}

/**
 * `powershell.exe` by bare name, via a PATH lookup — works in an interactive login shell (WSL's
 * `interop.appendWindowsPath` appends the Windows PATH there) and NOWHERE ELSE. Measured on a real
 * machine: the same command that printed real output from an interactive bash session threw
 * `ENOENT` from `Bun.spawnSync` and answered `sh: 1: powershell.exe: not found` from `sh -c` — the
 * two contexts this feature actually runs in, `agentop-server.service` (systemd, no login shell)
 * and this module's own spawn. The Windows PATH is a login-shell-only convenience, not a property
 * of the process environment, so nothing here may depend on it.
 */
const POWERSHELL_PATHS = [
  // The one location Windows PowerShell 5.1 ships at on every Windows install, confirmed present
  // and working via Bun.spawnSync directly on the machine this was measured on. `/mnt/c` is the
  // default WSL2 automount root; a machine with a customized one falls through to the PATH lookup.
  '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
  'powershell.exe',
]

/**
 * The Windows host's current TCP port exclusions, via WSL's interop with `powershell.exe` — or
 * `null` when the answer could not be verified (no interop, `powershell.exe` missing everywhere
 * tried, a non-zero exit, a hang past the timeout, or an exception). `null` must never be read as
 * "no exclusions": it means this machine could not be asked, and the caller's job is to change
 * NOTHING on that uncertainty, the same way an unreadable directory reports `missing` rather than
 * "not a repo".
 */
export function readWindowsExcludedPortRanges(timeoutMs = 4000): PortRange[] | null {
  for (const bin of POWERSHELL_PATHS) {
    try {
      const result = Bun.spawnSync(
        [bin, '-NoProfile', '-NonInteractive', '-Command', 'netsh interface ipv4 show excludedportrange protocol=tcp'],
        { stdout: 'pipe', stderr: 'ignore', timeout: timeoutMs },
      )
      if (result.exitCode === 0) return parseExcludedRanges(result.stdout.toString('utf8'))
    } catch {
      // Try the next candidate — ENOENT here is the ordinary case for whichever path is not this
      // machine's, not a reason to give up on the other one.
    }
  }
  return null
}

/** Why `resolveWslPorts` returned what it did — every branch is a sentence somewhere, never a
 *  silent choice. See `wsl-ports.ts`'s header for the failure this exists to catch. */
export type WslPortStatus =
  | 'not-wsl' // not running under WSL2 — the whole feature does not apply
  | 'unknown' // WSL2, but Windows' exclusion table could not be read — left untouched
  | 'clear' // WSL2, checked, and the configured ports are not excluded
  | 'resolved' // WSL2, the configured ports ARE excluded, and a free pair was found
  | 'unresolved' // WSL2, excluded, and no free pair turned up within the search budget

export interface WslPortResolution {
  port: number
  webPort: number
  status: WslPortStatus
}

/**
 * Resolve the port pair to actually bind, given the configured default — PORT/WEB_PORT unchanged
 * unless WSL2 is detected AND the default pair is confirmed excluded AND a working pair exists.
 * Every other case returns the untouched default, with `status` naming why nothing moved.
 */
export function resolveWslPorts(defaultPort: number): WslPortResolution {
  const webPort = defaultPort + 1
  if (!isWSL()) return { port: defaultPort, webPort, status: 'not-wsl' }

  const ranges = readWindowsExcludedPortRanges()
  if (ranges === null) return { port: defaultPort, webPort, status: 'unknown' }

  if (!portInAnyRange(ranges, defaultPort) && !portInAnyRange(ranges, webPort)) {
    return { port: defaultPort, webPort, status: 'clear' }
  }

  const found = findFreePortPair(ranges, defaultPort + 1)
  if (!found) return { port: defaultPort, webPort, status: 'unresolved' }
  return { port: found.port, webPort: found.webPort, status: 'resolved' }
}
