import { describe, expect, it } from 'bun:test'
import { parseSessionArgs } from './cli-parse'

describe('parseSessionArgs', () => {
  it('starts a background session on the given harness', () => {
    expect(parseSessionArgs(['claude', '--bg', '-p', 'fix the tests'])).toEqual({
      kind: 'start', harness: 'claude', background: true, prompt: 'fix the tests',
    })
  })

  it('attaches by default when --bg is absent', () => {
    expect(parseSessionArgs(['claude', '-p', 'hi'])).toEqual({
      kind: 'start', harness: 'claude', background: false, prompt: 'hi',
    })
  })

  it('reads model, effort, cwd and name', () => {
    expect(parseSessionArgs([
      'codex', '-p', 'do X', '--model', 'o3', '--effort', 'high', '--cwd', '/srv/app', '--name', 'refactor auth',
    ])).toEqual({
      kind: 'start', harness: 'codex', background: false, prompt: 'do X',
      model: 'o3', effort: 'high', cwd: '/srv/app', label: 'refactor auth',
    })
  })

  it('accepts a start with no prompt at all', () => {
    expect(parseSessionArgs(['kimi'])).toEqual({ kind: 'start', harness: 'kimi', background: false })
  })

  it('reads the subcommands', () => {
    expect(parseSessionArgs(['list'])).toEqual({ kind: 'list' })
    expect(parseSessionArgs(['attach', 'a1'])).toEqual({ kind: 'attach', ref: 'a1' })
    expect(parseSessionArgs(['kill', 'a1'])).toEqual({ kind: 'kill', ref: 'a1' })
    expect(parseSessionArgs(['rename', 'a1', 'refactor auth'])).toEqual({ kind: 'rename', ref: 'a1', label: 'refactor auth' })
    expect(parseSessionArgs(['note', 'a1', 'split the god object'])).toEqual({ kind: 'note', ref: 'a1', text: 'split the god object' })
  })

  it('rejects a harness that is not a harness', () => {
    expect(parseSessionArgs(['nonsense'])).toEqual({ kind: 'error', message: expect.stringContaining('nonsense') })
  })

  it('rejects a flag with no value instead of swallowing the next token', () => {
    expect(parseSessionArgs(['claude', '--model'])).toEqual({ kind: 'error', message: expect.stringContaining('--model') })
    expect(parseSessionArgs(['claude', '--model', '--bg'])).toEqual({ kind: 'error', message: expect.stringContaining('--model') })
  })

  it('rejects an unknown option instead of silently ignoring it', () => {
    expect(parseSessionArgs(['claude', '--nope'])).toEqual({ kind: 'error', message: expect.stringContaining('--nope') })
  })

  it('rejects two adjacent value flags rather than one swallowing the other as its value', () => {
    // `--model` has no value of its own here — `--cwd` is the next TOKEN, not a model id — so this
    // must be the same "missing value" error as `--model` followed by nothing at all.
    expect(parseSessionArgs(['claude', '--model', '--cwd', '/srv/app']))
      .toEqual({ kind: 'error', message: expect.stringContaining('--model') })
  })

  it('rejects a subcommand missing its reference', () => {
    expect(parseSessionArgs(['attach'])).toEqual({ kind: 'error', message: expect.stringContaining('attach') })
    expect(parseSessionArgs(['rename', 'a1'])).toEqual({ kind: 'error', message: expect.stringContaining('rename') })
  })

  it('asks for help with no arguments', () => {
    expect(parseSessionArgs([])).toEqual({ kind: 'help' })
  })
})

describe('batch — the form an assistant drives', () => {
  it('parses a task and one session per --session', () => {
    const cmd = parseSessionArgs([
      'batch', '--task', 'auth', '--session', 'claude: fix the store', '--session', 'codex: port tests',
    ])
    expect(cmd).toMatchObject({
      kind: 'batch',
      task: 'auth',
      specs: [
        { harness: 'claude', prompt: 'fix the store' },
        { harness: 'codex', prompt: 'port tests' },
      ],
    })
  })

  it('applies a shared --cwd to every session, and lets @ override it', () => {
    // A batch is usually many assistants on ONE repository, and repeating the path per session is
    // how a generated command line gets long enough to be got wrong.
    const cmd = parseSessionArgs([
      'batch', '--task', 't', '--cwd', '/repo',
      '--session', 'claude: a', '--session', 'codex@/other: b',
    ])
    expect(cmd).toMatchObject({
      specs: [{ cwd: '/repo' }, { cwd: '/other' }],
    })
  })

  it('refuses a batch with no task, because the sessions must belong together', () => {
    expect(parseSessionArgs(['batch', '--session', 'claude: a'])).toMatchObject({ kind: 'error' })
  })

  it('refuses a batch with no sessions', () => {
    expect(parseSessionArgs(['batch', '--task', 't'])).toMatchObject({ kind: 'error' })
  })

  it('refuses an unknown harness by name rather than starting nothing silently', () => {
    const cmd = parseSessionArgs(['batch', '--task', 't', '--session', 'gpt5: hi'])
    expect(cmd).toMatchObject({ kind: 'error' })
    expect((cmd as { message: string }).message).toContain('gpt5')
  })

  it('takes a session with no prompt at all', () => {
    expect(parseSessionArgs(['batch', '--task', 't', '--session', 'claude'])).toMatchObject({
      specs: [{ harness: 'claude' }],
    })
  })

  it('carries --json through', () => {
    expect(parseSessionArgs(['batch', '--task', 't', '--session', 'claude: a', '--json']))
      .toMatchObject({ json: true })
    expect(parseSessionArgs(['list', '--json'])).toMatchObject({ kind: 'list', json: true })
  })

  it('parses open with a multi-word task name', () => {
    expect(parseSessionArgs(['open', 'auth', 'refactor'])).toMatchObject({
      kind: 'open', task: 'auth refactor',
    })
  })
})
