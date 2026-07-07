import type { SessionMeta } from '@agentistics/core'

/** Copy-ready shell command to resume a session. Claude only; null for other harnesses. */
export function resumeCommand(s: SessionMeta): string | null {
  if (s.harness !== 'claude') return null
  const resume = `claude --resume ${s.session_id}`
  return s.project_path ? `cd ${s.project_path} && ${resume}` : resume
}
