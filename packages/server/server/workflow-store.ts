import { join } from 'path'
import { mkdir, writeFile, readFile } from 'fs/promises'
import type { WorkflowRun } from '@agentistics/core'
import { WORKFLOWS_STORE_DIR, ARCHIVE_ENABLED } from './config'
import { createLimiter, safeReadDir, safeReadJson } from './utils'

const writeLimit = createLimiter(20)
let ready = false
async function ensureDir() { if (!ready) { await mkdir(WORKFLOWS_STORE_DIR, { recursive: true }); ready = true } }

/** Persist workflow runs so they survive Claude's 30-day transcript cleanup. Skip-if-identical. */
export async function writeWorkflowRuns(runs: WorkflowRun[]): Promise<number> {
  if (!ARCHIVE_ENABLED || runs.length === 0) return 0
  await ensureDir()
  const counts = await Promise.all(runs.map(r => writeLimit(async () => {
    if (!r.runId) return 0
    const dest = join(WORKFLOWS_STORE_DIR, `${r.runId}.json`)
    const next = JSON.stringify(r)
    const prev = await readFile(dest, 'utf-8').catch(() => null)
    if (prev === next) return 0
    await writeFile(dest, next)
    return 1
  })))
  return counts.reduce<number>((a, b) => a + b, 0)
}

export async function loadWorkflowRuns(): Promise<Map<string, WorkflowRun>> {
  const map = new Map<string, WorkflowRun>()
  const limit = createLimiter(40)
  const files = await safeReadDir(WORKFLOWS_STORE_DIR)
  await Promise.all(files.filter(f => f.endsWith('.json')).map(f => limit(async () => {
    const r = await safeReadJson<WorkflowRun>(join(WORKFLOWS_STORE_DIR, f))
    if (r?.runId && !map.has(r.runId)) map.set(r.runId, r)
  })))
  return map
}
