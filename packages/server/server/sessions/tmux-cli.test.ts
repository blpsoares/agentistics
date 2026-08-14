import { describe, expect, it } from 'bun:test'
import {
  LIST_FORMAT, attachArgs, capturePaneArgs, captureFailureFor, idFromTmuxName, isSessionGoneError,
  killSessionArgs, newSessionArgs, parsePrefix, parseTmuxList, sendKeysEnterArgs,
  sendKeysLiteralArgs, trimCapture, tmuxName,
} from './tmux-cli'

describe('names', () => {
  it('namespaces our sessions', () => {
    expect(tmuxName('a1b2')).toBe('agentop-a1b2')
    expect(idFromTmuxName('agentop-a1b2')).toBe('a1b2')
  })

  it("ignores a session that is not ours", () => {
    expect(idFromTmuxName('my-own-work')).toBeNull()
  })
})

describe('newSessionArgs', () => {
  it('uses our socket, detaches, sets the cwd, and separates the command with --', () => {
    expect(newSessionArgs({ id: 'a1', cwd: '/home/u/p', argv: ['claude', '--model', 'opus', 'fix it'] }))
      .toEqual([
        '-L', 'agentop', 'new-session', '-d', '-s', 'agentop-a1', '-c', '/home/u/p',
        '--', 'claude', '--model', 'opus', 'fix it',
      ])
  })
})

describe('the other argv builders', () => {
  it('builds them all against our socket and our session name', () => {
    expect(killSessionArgs('a1')).toEqual(['-L', 'agentop', 'kill-session', '-t', 'agentop-a1'])
    expect(capturePaneArgs('a1', 40)).toEqual(['-L', 'agentop', 'capture-pane', '-p', '-t', 'agentop-a1', '-S', '-40'])
    expect(sendKeysLiteralArgs('a1', 'hello there')).toEqual(['-L', 'agentop', 'send-keys', '-t', 'agentop-a1', '-l', 'hello there'])
    expect(sendKeysEnterArgs('a1')).toEqual(['-L', 'agentop', 'send-keys', '-t', 'agentop-a1', 'Enter'])
    expect(attachArgs('a1')).toEqual(['tmux', '-L', 'agentop', 'attach-session', '-t', 'agentop-a1'])
  })
})

describe('parseTmuxList', () => {
  const line = (n: string, created: string, attached: string, dead: string, activity: string) =>
    [n, created, attached, dead, activity].join('\t')

  it('reads the fields our LIST_FORMAT asks for, converting seconds to ms', () => {
    expect(parseTmuxList(line('agentop-a1', '1786562971', '0', '0', '1786563000'))).toEqual([
      { id: 'a1', createdMs: 1_786_562_971_000, attached: false, alive: true, lastActivityMs: 1_786_563_000_000 },
    ])
  })

  it('reads a dead pane as not alive, without dropping the session', () => {
    const [s] = parseTmuxList(line('agentop-a1', '1786562971', '0', '1', '1786563000'))
    expect(s!.alive).toBe(false)
  })

  it('reads an attached session as attached', () => {
    const [s] = parseTmuxList(line('agentop-a1', '1786562971', '1', '0', '1786563000'))
    expect(s!.attached).toBe(true)
  })

  it("ignores the user's own tmux sessions", () => {
    expect(parseTmuxList(line('my-own-work', '1786562971', '0', '0', '1786563000'))).toEqual([])
  })

  it('ignores blank lines and malformed rows rather than throwing', () => {
    expect(parseTmuxList('\n\nagentop-a1\nagentop-b2\t1786562971\t0\t0\t1786563000\n')).toHaveLength(1)
  })

  it('is empty for the empty output of a server with no sessions', () => {
    expect(parseTmuxList('')).toEqual([])
  })

  it('asks for exactly the fields it parses', () => {
    expect(LIST_FORMAT).toBe('#{session_name}\t#{session_created}\t#{session_attached}\t#{pane_dead}\t#{session_activity}')
  })
})

describe('trimCapture', () => {
  it('drops the blank padding capture-pane appends, keeping interior blanks', () => {
    expect(trimCapture(['a', '', 'b', '', '', ''])).toEqual(['a', '', 'b'])
  })

  it('survives an all-blank frame', () => {
    expect(trimCapture(['', '', ''])).toEqual([])
  })
})

describe('parsePrefix', () => {
  it('turns tmux notation into the keystroke a person reads', () => {
    expect(parsePrefix('prefix C-b')).toBe('Ctrl-b')
    expect(parsePrefix('prefix C-a')).toBe('Ctrl-a')
  })

  it('falls back to the raw value rather than claiming Ctrl-b', () => {
    expect(parsePrefix('prefix M-x')).toBe('M-x')
  })

  // The KEY only — no "then d", and no English word of any kind. The sentence is the front end's,
  // and one of the two front ends speaks Portuguese.
  it('returns only the key, never a sentence', () => {
    for (const out of ['prefix C-b', 'prefix M-x', '']) {
      expect(parsePrefix(out)).not.toContain(' ')
    }
  })

  it('answers an unreadable prefix with nothing rather than with English', () => {
    expect(parsePrefix('')).toBe('')
    expect(parsePrefix('prefix')).toBe('')
  })
})

describe('isSessionGoneError', () => {
  it('recognizes every wording tmux 3.2a uses for "already gone"', () => {
    expect(isSessionGoneError("can't find session: agentop-a1")).toBe(true)
    expect(isSessionGoneError('no server running on /tmp/tmux-1000/agentop')).toBe(true)
    expect(isSessionGoneError('error connecting to /tmp/tmux-1000/agentop (No such file or directory)')).toBe(true)
  })

  it('treats any other stderr as a real failure, never a guessed "gone"', () => {
    expect(isSessionGoneError('permission denied')).toBe(false)
    expect(isSessionGoneError('')).toBe(false)
  })
})

describe('captureFailureFor', () => {
  it("reads tmux's own words for a session that is not there", () => {
    expect(captureFailureFor("can't find session: agentop-a1")).toBe('no-session')
    expect(captureFailureFor('no server running on /tmp/tmux-1000/agentop')).toBe('no-session')
  })

  it('calls anything else a backend error rather than guessing it away', () => {
    expect(captureFailureFor('some tmux failure nobody has seen')).toBe('backend-error')
    expect(captureFailureFor('')).toBe('backend-error')
  })
})
