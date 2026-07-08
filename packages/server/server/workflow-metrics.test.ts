import { test, expect } from 'bun:test'
import { discoverWorkflowLaunches } from './workflow-metrics'

test('discovers a local_workflow launch by runId', () => {
  const lines = [
    JSON.stringify({ type: 'user', timestamp: '2026-07-07T10:00:00Z', toolUseResult: { taskType: 'local_workflow', runId: 'wf_abc123', workflowName: 'review', scriptPath: '/x.js' } }),
  ]
  const r = discoverWorkflowLaunches(lines)
  expect(r.length).toBe(1)
  expect(r[0]!.runId).toBe('wf_abc123')
  expect(r[0]!.name).toBe('review')
})

test('ignores non-workflow toolUseResults', () => {
  const lines = [JSON.stringify({ type: 'user', toolUseResult: { taskType: 'other' } })]
  expect(discoverWorkflowLaunches(lines).length).toBe(0)
})
