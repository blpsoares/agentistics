/**
 * wsl-ports.ts — WSL2 finds its own ports excluded by Windows before it ever tries to bind them.
 *
 * WHY IT EXISTS. Windows' WinNAT reserves a contiguous block of TCP ports for its own use every
 * time the Hyper-V / WSL network stack comes up, and it is NOT the same block twice — reboot,
 * `wsl --shutdown`, Docker Desktop or a VPN reconnecting can all trigger a new reservation. When
 * agentistics' fixed ports (47291/47292) land inside one, the server binds fine INSIDE the WSL2 VM
 * (`0.0.0.0:47292`, confirmed reachable over the LAN and over Tailscale) while Windows silently
 * refuses to relay `localhost:47292` to it at all — `ERR_CONNECTION_REFUSED`, with nothing in
 * either the server's own log or the browser to say why. Measured on a real machine: the excluded
 * range was `47277-47376`, covering both ports exactly.
 *
 * `netsh interface ipv4 show excludedportrange protocol=tcp` is a READ-ONLY query and needs no
 * elevation, so this can run on every WSL2 boot without asking anything of the user — unlike the
 * actual fix (`net stop winnat && net start winnat`), which needs an elevated PowerShell and is a
 * decision for a person, never something this process does on its own.
 *
 * PARSING IS LOCALE-AGNOSTIC ON PURPOSE. The table's headers came back in Portuguese on the
 * machine this was measured on ("Porta Inicial / Porta Final") and would read differently on an
 * English or any other Windows install — the same trap `docs/harness-contract.md`'s pricing
 * scrapers already avoid by reading cells positionally rather than by label. `parseExcludedRanges`
 * therefore looks for lines that are exactly two integers (an optional trailing `*` for an
 * "administered" range), and ignores everything else — the header row, the dashed separator, the
 * legend line — because none of those match the shape.
 */

export interface PortRange {
  start: number
  end: number
}

const RANGE_LINE = /^\s*(\d+)\s+(\d+)\s*\*?\s*$/

/** Every `start end` pair in a `netsh ... excludedportrange` table — PURE, and total: bad input
 *  (empty, an error message, a locale nobody has seen) yields an empty list, never a throw. */
export function parseExcludedRanges(output: string): PortRange[] {
  const ranges: PortRange[] = []
  for (const line of output.split(/\r?\n/)) {
    const m = RANGE_LINE.exec(line)
    if (!m) continue
    const start = Number.parseInt(m[1]!, 10)
    const end = Number.parseInt(m[2]!, 10)
    if (Number.isFinite(start) && Number.isFinite(end)) ranges.push({ start, end })
  }
  return ranges
}

/** Whether `port` falls inside any of `ranges`, inclusive on both ends — PURE. */
export function portInAnyRange(ranges: readonly PortRange[], port: number): boolean {
  return ranges.some(r => port >= r.start && port <= r.end)
}

/**
 * The next `{port, webPort}` pair (adjacent, `webPort = port + 1`) that clears every range in
 * `ranges` on BOTH ports — PURE.
 *
 * Starts the search at `from` (never below it — a fallback that could land BELOW the configured
 * port would be a second surprise on top of the first) and gives up after `maxAttempts`, returning
 * `null` rather than searching forever: a range built to span the whole budget in a test, or a
 * genuinely pathological exclusion table, must fail honestly instead of hanging the server start.
 */
export function findFreePortPair(
  ranges: readonly PortRange[],
  from: number,
  maxAttempts = 2000,
): { port: number; webPort: number } | null {
  for (let i = 0; i < maxAttempts; i++) {
    const port = from + i
    const webPort = port + 1
    if (!portInAnyRange(ranges, port) && !portInAnyRange(ranges, webPort)) return { port, webPort }
  }
  return null
}
