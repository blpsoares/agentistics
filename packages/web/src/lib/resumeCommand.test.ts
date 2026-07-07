import { test, expect } from 'bun:test'
import { resumeCommand } from './resumeCommand'
import type { SessionMeta, HarnessId } from '@agentistics/core'

function s(harness: HarnessId): SessionMeta {
  return { session_id: 'abc-123', project_path: '/home/u/proj', harness } as SessionMeta
}

test('claude yields cd + claude --resume', () => {
  expect(resumeCommand(s('claude'))).toBe('cd /home/u/proj && claude --resume abc-123')
})

test('non-claude harnesses yield null', () => {
  expect(resumeCommand(s('codex'))).toBeNull()
  expect(resumeCommand(s('gemini'))).toBeNull()
  expect(resumeCommand(s('copilot'))).toBeNull()
})

test('claude without project_path still resumes without cd', () => {
  const noPath = { session_id: 'x', project_path: '', harness: 'claude' } as SessionMeta
  expect(resumeCommand(noPath)).toBe('claude --resume x')
})
