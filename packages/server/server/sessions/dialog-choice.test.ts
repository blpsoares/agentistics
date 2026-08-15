import { describe, expect, it } from 'bun:test'
import { needsChoice, parseDialogOptions } from './dialog-choice'

/**
 * VERBATIM from a live claude 2.1.232 Write permission prompt, 2026-08-14.
 *
 * The dialog this feature's first version treated as a yes/no. It is not one: option 2 grants
 * standing permission for the rest of the session, which is a materially different answer from
 * option 1, and a keystroke called "approve" picked whichever was highlighted.
 */
const WRITE_PERMISSION = [
  ' Create file',
  ' agentop-choice-probe.txt',
  '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  '  1 probe',
  '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  ' Do you want to create agentop-choice-probe.txt?',
  ' ❯ 1. Yes',
  '   2. Yes, allow all edits during this session (shift+tab)',
  '   3. No',
  '',
  ' Esc to cancel · Tab to amend',
]

/**
 * VERBATIM from a live claude 2.1.232 `AskUserQuestion`, 2026-08-14.
 *
 * The shape the user was looking at when they reported this: options with DESCRIPTION lines under
 * them, a free-text escape hatch, and a fifth option below a horizontal rule.
 */
const ASK_QUESTION = [
  '────────────────────────────────────────',
  ' ☐ Deploy',
  '',
  'Como você quer fazer o deploy?',
  '',
  '❯ 1. Deploy manual via CLI',
  '     Você (ou eu) roda o comando de deploy direto do terminal — controle total, sem',
  '     configuração extra, mas cada release depende de alguém executar o comando.',
  '  2. CI/CD automático no push',
  '     Um pipeline faz build, testes e deploy a cada push na branch principal.',
  '  3. Deploy por tag/release',
  '     O pipeline dispara só quando você cria uma tag ou release.',
  '  4. Type something.',
  '────────────────────────────────────────',
  '  5. Chat about this',
  '',
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
]

describe('parseDialogOptions', () => {
  it('reads a permission prompt as the THREE-way choice it actually is', () => {
    const out = parseDialogOptions(WRITE_PERMISSION)
    expect(out.map(o => o.number)).toEqual([1, 2, 3])
    expect(out.map(o => o.label)).toEqual([
      'Yes',
      'Yes, allow all edits during this session (shift+tab)',
      'No',
    ])
  })

  it('marks the row the dialog is highlighting, and only that one', () => {
    const out = parseDialogOptions(WRITE_PERMISSION)
    expect(out.filter(o => o.selected).map(o => o.number)).toEqual([1])
  })

  it('reads a question whose options carry DESCRIPTIONS under them', () => {
    // The continuation lines are indented prose, not options, and must not become entries.
    const out = parseDialogOptions(ASK_QUESTION)
    expect(out.map(o => o.number)).toEqual([1, 2, 3, 4, 5])
    expect(out[0]!.label).toBe('Deploy manual via CLI')
    expect(out[3]!.label).toBe('Type something.')
  })

  it('crosses the rule that separates the last option from the block', () => {
    // `5. Chat about this` sits below a horizontal rule. Stopping at the rule would drop a real
    // answer, and the numbers would then still look consecutive — a silent, plausible truncation.
    expect(parseDialogOptions(ASK_QUESTION).map(o => o.label)).toContain('Chat about this')
  })

  // --- the confidence gates ------------------------------------------------------------------

  it('reads the LAST block, not a numbered list further up the conversation', () => {
    const frame = [
      '● Here is my plan:',
      '  1. read the file',
      '  2. change it',
      '  3. run the tests',
      '',
      ' Do you want to proceed?',
      ' ❯ 1. Yes',
      '   2. No',
      ' Esc to cancel · Tab to amend',
    ]
    expect(parseDialogOptions(frame).map(o => o.label)).toEqual(['Yes', 'No'])
  })

  it('refuses a list whose numbers are not exactly 1..n', () => {
    // Half-read options are worse than none: they would be OFFERED, as if they were the whole menu.
    expect(parseDialogOptions([' 1. a', ' 3. c'])).toEqual([])
    expect(parseDialogOptions([' 2. b', ' 3. c'])).toEqual([])
    expect(parseDialogOptions([' 1. a', ' 2. b', ' 2. b again'])).toEqual([])
  })

  it('refuses a single option — that is a statement, not a choice', () => {
    expect(parseDialogOptions([' 1. Yes'])).toEqual([])
  })

  it('refuses a frame showing two cursors, which it does not understand', () => {
    expect(parseDialogOptions([' ❯ 1. a', ' ❯ 2. b'])).toEqual([])
  })

  it('refuses a bare number with no text after it', () => {
    // Far more likely an ordinal in prose than a menu entry.
    expect(parseDialogOptions([' 1. ', ' 2. '])).toEqual([])
  })

  it('is empty for a dialog that offers nothing to choose between', () => {
    // codex: `Press enter to continue`. There is genuinely no choice, and the caller confirms.
    expect(parseDialogOptions(['Update available', '', 'Press enter to continue'])).toEqual([])
    expect(parseDialogOptions([])).toEqual([])
  })

  it('does not scan the whole scrollback looking for a 1', () => {
    const long = Array.from({ length: 500 }, (_, i) => `line ${i}`)
    expect(parseDialogOptions([...long, ' 7. stray'])).toEqual([])
  })
})

describe('needsChoice', () => {
  it('is the question the UI asks before it may send a bare confirm', () => {
    expect(needsChoice(parseDialogOptions(WRITE_PERMISSION))).toBe(true)
    expect(needsChoice(parseDialogOptions(ASK_QUESTION))).toBe(true)
    expect(needsChoice([])).toBe(false)
  })
})
