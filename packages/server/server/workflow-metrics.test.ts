import { test, expect } from 'bun:test'
import { discoverWorkflowLaunches, sortAgentFiles } from './workflow-metrics'

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

test('sortAgentFiles orders by numeric index, not lexically', () => {
  expect(sortAgentFiles(['agent-10.jsonl', 'agent-2.jsonl', 'agent-1.jsonl']))
    .toEqual(['agent-1.jsonl', 'agent-2.jsonl', 'agent-10.jsonl'])
})

test('sortAgentFiles puts unparseable names last, stably', () => {
  expect(sortAgentFiles(['agent-3.jsonl', 'weird.jsonl', 'agent-1.jsonl']))
    .toEqual(['agent-1.jsonl', 'agent-3.jsonl', 'weird.jsonl'])
})

// ---------------------------------------------------------------------------
// Regression: a run's transcripts are agent-<hash>.jsonl. Pairing them with the
// script's agent() calls by position (after an alphabetical file sort) gave every
// agent a label belonging to a different agent. Metrics must follow the PROMPT.
// ---------------------------------------------------------------------------

import { mkdtemp, mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { extractWorkflowRuns } from './workflow-metrics'

const RUN_ID = 'wf_test-0001'

function transcript(prompt: string, out: number): string {
  return [
    JSON.stringify({ type: 'user', timestamp: '2026-08-04T14:55:52.000Z', message: { content: prompt } }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: out, cache_read_input_tokens: out * 100, cache_creation_input_tokens: out * 10 } } }),
  ].join('\n')
}

test('agents are labelled by their prompt, not by the alphabetical order of their file hash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentistics-wf-'))
  const runDir = join(root, RUN_ID)
  await mkdir(runDir, { recursive: true })

  const script = [
    "export const meta = { name: 'demo', phases: [{ title: 'Recon' }, { title: 'Fix' }] }",
    "await agent(`TAREFA: mapeie a camada de servicos em background, so leitura.`, { label: 'recon:services', phase: 'Recon' })",
    "await agent(`TAREFA: mapeie a camada de mouse e o parser SGR, so leitura.`, { label: 'recon:mouse', phase: 'Recon' })",
    "await agent(`TAREFA: conserte os backends de servico conforme o recon acima.`, { label: 'fix:backends', phase: 'Fix' })",
  ].join('\n')
  const scriptPath = join(root, 'demo.js')
  await writeFile(scriptPath, script)

  // Hashes chosen so the alphabetical order is the REVERSE of the declared order.
  await writeFile(join(runDir, 'agent-a11.jsonl'), transcript('TAREFA: conserte os backends de servico conforme o recon acima.', 300))
  await writeFile(join(runDir, 'agent-b22.jsonl'), transcript('TAREFA: mapeie a camada de mouse e o parser SGR, so leitura.', 200))
  await writeFile(join(runDir, 'agent-c33.jsonl'), transcript('TAREFA: mapeie a camada de servicos em background, so leitura.', 100))

  const main = [
    JSON.stringify({
      timestamp: '2026-08-04T14:55:00.000Z',
      toolUseResult: { taskType: 'local_workflow', runId: RUN_ID, workflowName: 'demo', scriptPath },
    }),
  ]

  const [run] = await extractWorkflowRuns(main, 'sess-1', root)
  const byLabel = new Map(run!.agents.map(a => [a.label, a]))
  expect(byLabel.get('recon:services')!.tokensOut).toBe(100)
  expect(byLabel.get('recon:mouse')!.tokensOut).toBe(200)
  expect(byLabel.get('fix:backends')!.tokensOut).toBe(300)
  expect(byLabel.get('fix:backends')!.phase).toBe('Fix')
})

test('run totals carry the cache tokens the agents were billed for', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentistics-wf-'))
  const runDir = join(root, RUN_ID)
  await mkdir(runDir, { recursive: true })
  const scriptPath = join(root, 'demo.js')
  await writeFile(scriptPath, "export const meta = { name: 'demo', phases: [{ title: 'Recon' }] }\nawait agent(`TAREFA: mapeie a camada de servicos em background, so leitura.`, { label: 'recon:services', phase: 'Recon' })")
  await writeFile(join(runDir, 'agent-a11.jsonl'), transcript('TAREFA: mapeie a camada de servicos em background, so leitura.', 100))

  const main = [JSON.stringify({ timestamp: 't', toolUseResult: { taskType: 'local_workflow', runId: RUN_ID, workflowName: 'demo', scriptPath } })]
  const [run] = await extractWorkflowRuns(main, 'sess-1', root)
  expect(run!.totals.cacheRead).toBe(10000)
  expect(run!.totals.cacheWrite).toBe(1000)
})

test('a transcript no call claims keeps its file name — never a label from another agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentistics-wf-'))
  const runDir = join(root, RUN_ID)
  await mkdir(runDir, { recursive: true })
  const scriptPath = join(root, 'demo.js')
  await writeFile(scriptPath, "export const meta = { name: 'demo', phases: [{ title: 'Recon' }] }\nawait agent(`TAREFA: mapeie a camada de servicos em background, so leitura.`, { label: 'recon:services', phase: 'Recon' })")
  await writeFile(join(runDir, 'agent-zz9.jsonl'), transcript('um prompt totalmente dinamico que o script nao revela', 42))

  const main = [JSON.stringify({ timestamp: 't', toolUseResult: { taskType: 'local_workflow', runId: RUN_ID, workflowName: 'demo', scriptPath } })]
  const [run] = await extractWorkflowRuns(main, 'sess-1', root)
  expect(run!.agents[0]!.label).toBe('agent-zz9')
  expect(run!.agents[0]!.phase).toBe('')
})
