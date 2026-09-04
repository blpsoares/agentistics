import { test, expect } from 'bun:test'
import { parseReply, quoteLines, replyAuthor, replyPreview } from './replyQuote'

test('a quote is "> "-prefixed, line by line', () => {
  expect(quoteLines('one\ntwo')).toBe('> one\n> two')
})

test('a long message is bounded and SAYS there was more', () => {
  const out = quoteLines('a\nb\nc\nd\ne\nf')
  expect(out.split('\n')).toHaveLength(5)
  expect(out.endsWith('> …')).toBe(true)
})

test('a message at exactly the bound carries no ellipsis', () => {
  expect(quoteLines('a\nb\nc\nd')).toBe('> a\n> b\n> c\n> d')
})

test('quoting nothing is EMPTY, never a lone marker', () => {
  expect(quoteLines('')).toBe('')
  expect(quoteLines('   \n\n ')).toBe('')
})

test('the preview drops blank lines rather than counting them', () => {
  expect(replyPreview('# Heading\n\nthe actual sentence')).toBe('# Heading the actual sentence')
})

test('the preview says it was cut only when something was cut', () => {
  expect(replyPreview('one\ntwo')).toBe('one two')
  expect(replyPreview('one\ntwo\nthree')).toBe('one two …')
})

test('a preview of nothing is empty', () => {
  expect(replyPreview('\n\n  ')).toBe('')
})

test('the user is "You", the assistant is the harness', () => {
  expect(replyAuthor('user', 'Claude Code', 'en')).toBe('You')
  expect(replyAuthor('user', 'Claude Code', 'pt')).toBe('Você')
  expect(replyAuthor('assistant', 'Claude Code', 'en')).toBe('Claude Code')
})

test('a missing harness label falls back to a WORD, never an empty name', () => {
  for (const label of [undefined, '', '   ']) {
    expect(replyAuthor('assistant', label, 'en')).toBe('the assistant')
    expect(replyAuthor('assistant', label, 'pt')).toBe('o assistente')
  }
})

test('a stored reply round-trips', () => {
  const target = { role: 'assistant' as const, text: 'what it said' }
  expect(parseReply(JSON.stringify(target))).toEqual(target)
})

test('anything that is not a usable target is dropped, never half-read', () => {
  for (const raw of [
    null, '', 'not json', '[]', '{}', '{"role":"nobody","text":"x"}',
    '{"role":"user"}', '{"role":"user","text":""}', '{"role":"user","text":"   "}',
    '{"role":"user","text":7}',
  ]) {
    expect(parseReply(raw)).toBeNull()
  }
})
