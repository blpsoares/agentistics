/**
 * proc-liveness.ts — is the process that wrote a record STILL the one answering to that pid?
 *
 * Split from `harness-sessions.ts` so the rule and the syscall are separable: `sameProcess` is pure
 * and tested, `readProcStart` is the one impure line and is Linux-only by construction.
 *
 * ## Why a pid is not enough, stated once
 *
 * These records outlive their processes on purpose — that is what keeps the name someone typed
 * readable on a `lost` row afterwards. Measured on this machine on 2026-08-15: 64 records, of which
 * **3** belonged to a running process. So the directory is mostly dead pids, and the OS reuses pid
 * numbers. Believing `pid` alone means reporting a long-dead session as running the moment its
 * number comes round again — on the row that claims a conversation is live, which is the worst
 * place in this product to be wrong.
 *
 * Field 22 of `/proc/<pid>/stat` is the process's start time in clock ticks since boot. Two
 * processes can share a pid; they cannot share a pid AND a start time. Verified against real data:
 * of the three records whose pid still existed, all three matched exactly.
 */

import { readFile } from 'node:fs/promises'

/**
 * Whether a record and a probe describe the SAME process — PURE.
 *
 * `undefined` from the probe means the pid does not exist: not running, and that is a real answer.
 * A record with no `procStart` (every claude before it started writing one) is the interesting case
 * and it is answered NO: without the anti-recycling key there is no way to tell a resumed pid from
 * the original, and this function's callers use it to claim a session is alive. An unproven claim
 * of liveness is worse than an absent one — the row stays as it was, which is today's behaviour.
 */
export function sameProcess(recorded: string | undefined, probed: string | undefined): boolean {
  if (!recorded || !probed) return false
  return recorded === probed
}

/**
 * Field 22 of `/proc/<pid>/stat`, or `undefined` when the pid does not exist or cannot be read.
 *
 * The parse is `rsplit` on `)` rather than a plain split, and that is load-bearing: field 2 is the
 * executable name IN PARENTHESES and it may itself contain spaces and parentheses. Splitting from
 * the left on whitespace puts every later field at an offset that depends on the program's name.
 * After the LAST `)`, the remaining fields start at field 3, so field 22 is index 19.
 */
export async function readProcStart(pid: number): Promise<string | undefined> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    const tail = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)
    const start = tail[19]
    return start && /^\d+$/.test(start) ? start : undefined
  } catch {
    // No /proc (not Linux), a pid that has gone, or a process this uid may not read. All three are
    // "cannot tell", and the caller must not turn that into "not running".
    return undefined
  }
}

/** True when `/proc` is readable at all — the platform gate for the whole feature. */
export async function procAvailable(): Promise<boolean> {
  try {
    await readFile('/proc/self/stat', 'utf8')
    return true
  } catch {
    return false
  }
}
