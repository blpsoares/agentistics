/**
 * stream.test.ts — the sanitiser, against the output it actually has to survive.
 *
 * This is the piece of the streaming pane most likely to be subtly wrong, so it is the piece most
 * tested: every case below is a shape real commands produce — docker's carriage-return progress,
 * buildkit's coloured `#N` steps, a pipe that splits mid-escape and mid-character, a build that
 * prints more lines than any pane could hold.
 */

import { describe, expect, test } from 'bun:test'
import {
  appendLines,
  createLineDecoder,
  decodeChunk,
  EMPTY_DECODER,
  flushDecoder,
  OUTPUT_MAX_LINES,
  stripAnsi,
  type DecoderState,
} from './stream'

/** Written as code points so this file stays plain text. */
const ESC = String.fromCharCode(27)

/** Feed a decoder the whole way through, chunk by chunk, and collect everything it emitted. */
function drain(chunks: (string | Uint8Array)[]): string[] {
  const decoder = createLineDecoder()
  const out: string[] = []
  for (const chunk of chunks) out.push(...decoder.push(chunk))
  out.push(...decoder.flush())
  return out
}

describe('stripAnsi', () => {
  test('colour goes, the text stays', () => {
    expect(stripAnsi(`${ESC}[32mDONE${ESC}[0m`)).toBe('DONE')
  })

  // The reason this module exists: a cursor move inside a pane moves the REAL cursor, and every
  // row Ink draws afterwards lands somewhere else.
  test('cursor movement and erase go — they would move the terminal, not colour it', () => {
    expect(stripAnsi(`${ESC}[2A${ESC}[2Kbuilding`)).toBe('building')
    expect(stripAnsi(`${ESC}[?25lhidden cursor${ESC}[?25h`)).toBe('hidden cursor')
  })

  test('an OSC string goes with either terminator', () => {
    expect(stripAnsi(`${ESC}]0;a title${String.fromCharCode(7)}text`)).toBe('text')
    expect(stripAnsi(`${ESC}]8;;http://x${ESC}\\link`)).toBe('link')
  })

  test('a tab becomes spaces, so the row is as wide as it looks', () => {
    expect(stripAnsi('a\tb')).toBe('a    b')
  })

  test('every other control byte goes — a width that lies breaks the truncation', () => {
    expect(stripAnsi(`step${String.fromCharCode(8)}${String.fromCharCode(7)}`)).toBe('step')
  })

  test('plain text is returned untouched', () => {
    expect(stripAnsi(' => [4/7] RUN bun install   ')).toBe(' => [4/7] RUN bun install   ')
  })
})

describe('decodeChunk', () => {
  const feed = (chunk: string, state: DecoderState = EMPTY_DECODER) => decodeChunk(state, chunk)

  test('a newline ends a line; what follows is held for the next chunk', () => {
    const out = feed('first\nsecond')
    expect(out.lines).toEqual(['first'])
    expect(out.state.line).toBe('second')
  })

  test('CRLF is ONE terminator, not an overwrite plus a blank line', () => {
    expect(feed('a\r\nb\r\n').lines).toEqual(['a', 'b'])
  })

  // The progress-redraw rule: a run of \r-updated fragments is one line, and its last fragment is
  // what it finally said.
  test('a run of carriage returns collapses to the LAST fragment', () => {
    const out = feed('#5 building 1.2s\r#5 building 2.4s\r#5 DONE 2.9s\n')
    expect(out.lines).toEqual(['#5 DONE 2.9s'])
  })

  test('a chunk ending on a carriage return keeps what the row says until it is replaced', () => {
    const first = feed('#5 building 1.2s\r')
    expect(first.lines).toEqual([])
    // Nothing replaced it, so the final state of the row is what it said.
    expect(flushDecoder(first.state).lines).toEqual(['#5 building 1.2s'])
    // …and when something does replace it, the earlier state is gone rather than concatenated.
    expect(feed('#5 DONE\n', first.state).lines).toEqual(['#5 DONE'])
  })

  test('a blank line the program printed is kept — it is output', () => {
    expect(feed('a\n\nb\n').lines).toEqual(['a', '', 'b'])
  })

  // The other half of the same rule, and the one that reads as a broken pane when it is wrong: a
  // row of pure control bytes is a redraw artifact, not a blank line the program printed.
  test('a line that was nothing but control bytes is dropped, not shown as blank', () => {
    expect(feed(`${ESC}[2K\n`).lines).toEqual([])
    expect(feed(`${ESC}[1A${ESC}[2K\nreal\n`).lines).toEqual(['real'])
  })

  test('trailing whitespace goes, leading indentation stays', () => {
    expect(feed('  => resolving   \n').lines).toEqual(['  => resolving'])
  })
})

describe('createLineDecoder', () => {
  test('a chunk split mid-line is one line, not two', () => {
    expect(drain(['bui', 'lding the mach', 'ine image\n'])).toEqual(['building the machine image'])
  })

  // A pipe splits wherever it likes, including inside an escape — and half a sequence rendered as
  // text is the sequence rendered as garbage.
  test('a chunk split mid-escape strips the escape, not half of it', () => {
    expect(drain([`${ESC}[3`, '2mDONE', `${ESC}[0m\n`])).toEqual(['DONE'])
  })

  test('a chunk split mid-character decodes as one character', () => {
    const bytes = new TextEncoder().encode('serviços\n')
    expect(drain([bytes.slice(0, 5), bytes.slice(5)])).toEqual(['serviços'])
  })

  test('the last line arrives even without a final newline', () => {
    expect(drain(['no trailing newline'])).toEqual(['no trailing newline'])
  })

  test('a flush after a final newline emits nothing', () => {
    expect(drain(['done\n'])).toEqual(['done'])
  })

  /**
   * The whole thing at once, in the shape `docker compose up --build` produces it: coloured
   * buildkit steps, a progress row rewritten in place, a blank separator, an error on stderr's
   * side of the same pane, and a chunk boundary in the middle of it all.
   */
  test('a realistic docker build comes out as the lines a reader wants', () => {
    const lines = drain([
      `${ESC}[?25l#1 [internal] load build definition\n`,
      '#1 transferring dockerfile: 1.2s\r#1 transferring dockerfile: 2.4s\r#1 DONE 2.4s\n\n',
      `#2 [builder 3/8] RUN bun install${ESC}[0m\n#2 sha256:9f2b`,
      `1c DONE 41.3s\n${ESC}[31mERROR: failed to solve\n${ESC}[?25h`,
    ])
    expect(lines).toEqual([
      '#1 [internal] load build definition',
      '#1 DONE 2.4s',
      '',
      '#2 [builder 3/8] RUN bun install',
      '#2 sha256:9f2b1c DONE 41.3s',
      'ERROR: failed to solve',
    ])
  })
})

describe('appendLines', () => {
  test('lines accumulate in order', () => {
    expect(appendLines(['a'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  test('nothing to add returns the buffer as it stands', () => {
    expect(appendLines(['a', 'b'], [])).toEqual(['a', 'b'])
  })

  // A ring, not a log: a cold-cache build prints thousands of lines and the pane shows a few dozen.
  test('the ring keeps the NEWEST lines and drops the oldest', () => {
    const many = Array.from({ length: 10 }, (_, i) => `line ${i}`)
    expect(appendLines([], many, 3)).toEqual(['line 7', 'line 8', 'line 9'])
    expect(appendLines(many, ['tail'], 2)).toEqual(['line 9', 'tail'])
  })

  test('an over-long buffer is trimmed even when nothing is added', () => {
    expect(appendLines(['a', 'b', 'c'], [], 1)).toEqual(['c'])
  })

  test('a build far longer than the bound stays bounded', () => {
    let buffer: string[] = []
    for (let i = 0; i < OUTPUT_MAX_LINES * 5; i++) buffer = appendLines(buffer, [`#${i}`])
    expect(buffer.length).toBe(OUTPUT_MAX_LINES)
    expect(buffer[buffer.length - 1]).toBe(`#${OUTPUT_MAX_LINES * 5 - 1}`)
  })

  test('a bound of nothing keeps nothing rather than throwing', () => {
    expect(appendLines(['a'], ['b'], 0)).toEqual([])
  })
})
