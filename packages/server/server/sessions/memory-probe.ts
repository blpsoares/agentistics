/**
 * memory-probe.ts — the impure half of the memory budget: reading this machine.
 *
 * Split from `memory-budget.ts` for the usual reason — the arithmetic is tested and the syscalls are
 * not — and kept deliberately small: two reads and a sum.
 *
 * **Where it cannot read, it returns `null` and the whole gauge is absent.** Not zero, not a
 * placeholder. `/proc` exists on Linux and on WSL; it does not on macOS or Windows, and a machine
 * that cannot be measured must show no gauge rather than a confident wrong one — the same rule
 * `ControlService.boot` follows for systemd and `HARNESS_CAPABILITIES` for metrics.
 */

import { readFile, readdir } from 'node:fs/promises'
import type { MemorySample } from './memory-budget'
import { parseMeminfo } from './memory-budget'

/** The machine's memory, or `null` where it cannot be read. */
export async function readMemory(): Promise<MemorySample | null> {
  try {
    return parseMeminfo(await readFile('/proc/meminfo', 'utf8'))
  } catch {
    return null
  }
}

/**
 * Total resident bytes of a set of pids, and how many were actually readable.
 *
 * `VmRSS` from `/proc/<pid>/status` rather than `statm`, because it is already in kB and labelled —
 * no page-size arithmetic to get wrong.
 *
 * **RSS of processes that share pages does not sum exactly.** It over-counts shared libraries, so
 * this figure is an upper bound. That is the right direction for this use — a budget that errs
 * toward "fewer sessions fit" fails safe — but it is stated here rather than left for someone to
 * discover, and it is why the surface says "recommended" and not "available".
 */
export async function readRss(pids: readonly number[]): Promise<{ bytes: number; read: number }> {
  let bytes = 0
  let read = 0
  for (const pid of pids) {
    try {
      const status = await readFile(`/proc/${pid}/status`, 'utf8')
      const m = /^VmRSS:\s+(\d+) kB$/m.exec(status)
      if (!m) continue
      bytes += Number(m[1]) * 1024
      read++
    } catch {
      // Gone between listing and reading, or a uid that may not look. Skipped, and the count says so.
    }
  }
  return { bytes, read }
}

/**
 * Every pid under a tmux session's process tree is NOT what this needs — the harness process is.
 *
 * The caller passes the pids it already knows about (from the harness records and from the process
 * scan), so this module never has to decide what an assistant is. It exists as a named export
 * because the alternative — each caller writing its own `/proc` read — is how two surfaces end up
 * disagreeing about the same number.
 */
export async function procPidsExist(): Promise<boolean> {
  try {
    await readdir('/proc/self')
    return true
  } catch {
    return false
  }
}
