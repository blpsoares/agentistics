/** Characterization: Claude's own git counting must not move when the rule is lifted out of this
 *  parser into the shared `harness-activity.ts`. */
import { test, expect } from 'bun:test'
import { mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseSessionJsonl } from './jsonl'

function bash(command: string): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-04T10:00:00.000Z',
    message: {
      model: 'claude-sonnet-5',
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command } }],
    },
  })
}

async function parse(lines: string[]) {
  const dir = await mkdtemp(join(tmpdir(), 'agentistics-jsonl-'))
  const file = join(dir, 's.jsonl')
  await writeFile(file, [
    JSON.stringify({ type: 'user', timestamp: '2026-08-04T09:59:00.000Z', cwd: '/repo', message: { role: 'user', content: 'go' } }),
    ...lines,
  ].join('\n'))
  return parseSessionJsonl(file, 's', '/repo', 'jsonl')
}

test('counts commits and pushes from Bash tool calls', async () => {
  const s = await parse([bash('git add -A && git commit -m "x" && git push')])
  expect(s.git_commits).toBe(1)
  expect(s.git_pushes).toBe(1)
})

test('counts each command of a multi-line script', async () => {
  const s = await parse([bash('git commit -m a\ngit commit -m b\ngit push')])
  expect(s.git_commits).toBe(2)
  expect(s.git_pushes).toBe(1)
})

test('a non-git Bash call counts nothing', async () => {
  const s = await parse([bash('bun test')])
  expect(s.git_commits).toBe(0)
  expect(s.git_pushes).toBe(0)
})
