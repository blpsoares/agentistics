/**
 * What THIS component adds to an already-tested client — and, above everything else, the ONE
 * guarantee the whole repository explorer is allowed to write under:
 *
 *   **A save never silently overwrites a change that landed on disk while the file was open.**
 *
 * `repoApi.test.ts` owns the three outcomes of a call and `repoErrorText.test.ts` owns the wording;
 * neither is re-asserted here. What is left is the save STATE MACHINE, and the last section of this
 * file drives it through a FAKE DISK that implements the server's contract exactly as
 * `editor-web.ts` does — a write is accepted only when its pinned mtime still matches, and a
 * mismatch writes NOTHING and answers 409 with the current content. That simulation is what makes
 * the guarantee a tested fact rather than a sentence in a header: it is asserted against what is on
 * the fake disk afterwards, not against what the UI believed.
 *
 * Rendering is `renderToStaticMarkup`, the stack `RepoTreeView.test.tsx` and
 * `RepoSearchView.test.tsx` already use: this repo has no `@testing-library/react`/jsdom (see
 * `ConnectionCard.test.tsx`'s own note), so typing cannot be simulated and `useEffect` never runs.
 * The strip, the banner and the question therefore take their state as props, exactly as
 * `RepoSearchResults` does, which is what makes every sentence assertable.
 */
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  binaryText, diskVersionOf, initialSaveState, isDirty, loadStateFor, monacoOptions,
  monacoThemeFor, nextSaveState, RepoConflictPrompt, RepoSaveStrip, RepoStaleBanner,
  saveButtonState, saveEventFor, saveGate, saveStatus,
  type SaveEvent, type SaveState,
} from './RepoFileEditor'
import type { ReadFileResult, WriteFileResult } from '../../lib/repoApi'

function noop() { /* these renders press nothing */ }

/** Apply a whole sequence, the way the component's reducer does. */
function run(state: SaveState, ...events: SaveEvent[]): SaveState {
  return events.reduce(nextSaveState, state)
}

const OPENED = initialSaveState(1000)

// --- reading one file ----------------------------------------------------------------------------

describe('loadStateFor', () => {
  test('text becomes READY, carrying the mtime the next write will be pinned to', () => {
    const res: ReadFileResult = { ok: true, content: 'const a = 1\n', mtimeMs: 1700 }
    expect(loadStateFor(res, 'en')).toEqual({ kind: 'ready', content: 'const a = 1\n', mtimeMs: 1700 })
  })

  test('an EMPTY file is a file, not a failure', () => {
    expect(loadStateFor({ ok: true, content: '', mtimeMs: 9 }, 'en'))
      .toEqual({ kind: 'ready', content: '', mtimeMs: 9 })
  })

  test('a BINARY file is its own state — never an empty editor', () => {
    expect(loadStateFor({ ok: true, binary: true, name: 'logo.png', size: 20480 }, 'en'))
      .toEqual({ kind: 'binary', name: 'logo.png', size: 20480 })
  })

  test('a refusal the server worded is carried through verbatim', () => {
    expect(loadStateFor({
      ok: false, failure: 'refused', status: 404, reason: 'not-found',
      message: 'Esse caminho não existe mais.',
    }, 'pt')).toEqual({ kind: 'failed', text: 'Esse caminho não existe mais.' })
  })

  test('a gate refusal carries no sentence, so the UI supplies one in the reader’s language', () => {
    const gate: ReadFileResult = { ok: false, failure: 'refused', status: 403, reason: 'editor_disabled' }
    expect(loadStateFor(gate, 'en')).toEqual({
      kind: 'failed', text: expect.stringContaining('Settings → Sessions'),
    })
    expect(loadStateFor(gate, 'pt')).toEqual({
      kind: 'failed', text: expect.stringContaining('Configurações → Sessões'),
    })
  })

  test('an unreachable server is SAID — never an empty buffer', () => {
    const state = loadStateFor({ ok: false, failure: 'unreachable', cause: 'timeout' }, 'en')
    expect(state.kind).toBe('failed')
    expect(state.kind === 'failed' && state.text.length > 0).toBe(true)
  })
})

describe('binaryText', () => {
  test('names the file, says what it is, and carries the size', () => {
    const text = binaryText({ name: 'logo.png', size: 20480 }, 'en')
    expect(text).toContain('logo.png')
    expect(text).toContain('20 KB')
    expect(text).toContain('binary')
  })

  test('localized, and the two languages differ', () => {
    expect(binaryText({ name: 'a.bin', size: 10 }, 'pt'))
      .not.toBe(binaryText({ name: 'a.bin', size: 10 }, 'en'))
    expect(binaryText({ name: 'a.bin', size: 10 }, 'pt')).toContain('binário')
  })
})

// --- the machine, transition by transition --------------------------------------------------------

describe('the save state machine', () => {
  test('a freshly read file is clean, pinned to the mtime it was read at', () => {
    expect(isDirty(OPENED)).toBe(false)
    expect(OPENED.mtimeMs).toBe(1000)
    expect(saveGate(OPENED)).toEqual({ allowed: false, why: 'clean' })
  })

  test('an edit makes it dirty, and a save may be attempted against the read mtime', () => {
    const edited = run(OPENED, { kind: 'edited' })
    expect(isDirty(edited)).toBe(true)
    expect(saveGate(edited)).toEqual({ allowed: true, mtimeMs: 1000 })
  })

  test('a successful write advances the pin and clears the dirt', () => {
    const saved = run(OPENED, { kind: 'edited' }, { kind: 'save-started' }, { kind: 'saved', mtimeMs: 2000 })
    expect(saved.mtimeMs).toBe(2000)
    expect(isDirty(saved)).toBe(false)
    expect(saved.phase.kind).toBe('saved')
  })

  test('typing DURING a save leaves the buffer dirty afterwards — the write carried the older text', () => {
    const after = run(
      OPENED,
      { kind: 'edited' },
      { kind: 'save-started' },
      { kind: 'edited' },
      { kind: 'saved', mtimeMs: 2000 },
    )
    expect(isDirty(after)).toBe(true)
    expect(after.mtimeMs).toBe(2000)
  })

  test('a CONFLICT moves the pin NOWHERE and clears nothing — this is the guarantee', () => {
    const conflicted = run(
      OPENED,
      { kind: 'edited' },
      { kind: 'save-started' },
      { kind: 'conflicted', diskContent: 'theirs', diskMtimeMs: 5000 },
    )
    expect(conflicted.mtimeMs).toBe(1000)
    expect(isDirty(conflicted)).toBe(true)
    expect(conflicted.phase).toEqual({ kind: 'conflict', diskContent: 'theirs', diskMtimeMs: 5000 })
  })

  test('a failed save keeps the pin and the dirt, and keeps its sentence', () => {
    const failed = run(
      OPENED,
      { kind: 'edited' },
      { kind: 'save-started' },
      { kind: 'save-failed', text: 'O servidor não respondeu.' },
    )
    expect(failed.mtimeMs).toBe(1000)
    expect(isDirty(failed)).toBe(true)
    expect(failed.phase).toEqual({ kind: 'failed', text: 'O servidor não respondeu.' })
  })

  test('typing does not dismiss an open question', () => {
    const conflicted = run(
      OPENED, { kind: 'edited' }, { kind: 'save-started' },
      { kind: 'conflicted', diskContent: 'theirs', diskMtimeMs: 5000 },
    )
    expect(run(conflicted, { kind: 'edited' }, { kind: 'edited' }).phase.kind).toBe('conflict')
  })

  test('typing DOES clear the two notices, which are about a write the buffer has moved past', () => {
    const saved = run(OPENED, { kind: 'edited' }, { kind: 'save-started' }, { kind: 'saved', mtimeMs: 2 })
    expect(run(saved, { kind: 'edited' }).phase.kind).toBe('idle')
    const failed = run(OPENED, { kind: 'edited' }, { kind: 'save-started' }, { kind: 'save-failed', text: 'x' })
    expect(run(failed, { kind: 'edited' }).phase.kind).toBe('idle')
  })

  test('"keep editing" becomes STALE and keeps the disk version for the two actions', () => {
    const stale = run(
      OPENED, { kind: 'edited' }, { kind: 'save-started' },
      { kind: 'conflicted', diskContent: 'theirs', diskMtimeMs: 5000 },
      { kind: 'dismiss-conflict' },
    )
    expect(stale.phase).toEqual({ kind: 'stale', diskContent: 'theirs', diskMtimeMs: 5000 })
    expect(diskVersionOf(stale.phase)).toEqual({ diskContent: 'theirs', diskMtimeMs: 5000 })
    expect(stale.mtimeMs).toBe(1000)
  })

  test('an explicit ask re-opens the question from STALE, and does nothing from anywhere else', () => {
    const stale = run(
      OPENED, { kind: 'edited' }, { kind: 'save-started' },
      { kind: 'conflicted', diskContent: 'theirs', diskMtimeMs: 5000 },
      { kind: 'dismiss-conflict' },
    )
    expect(run(stale, { kind: 'prompt-conflict' }).phase.kind).toBe('conflict')
    // From a clean, idle buffer there is no disk version to prompt ABOUT — inventing a dialog there
    // would ask a question nobody can answer.
    expect(run(OPENED, { kind: 'prompt-conflict' })).toBe(OPENED)
  })

  test('"save over it" moves the pin to the version it is overwriting, and stays dirty until written', () => {
    const chosen = run(
      OPENED, { kind: 'edited' }, { kind: 'save-started' },
      { kind: 'conflicted', diskContent: 'theirs', diskMtimeMs: 5000 },
      { kind: 'keep-mine' },
    )
    expect(chosen.mtimeMs).toBe(5000)
    expect(isDirty(chosen)).toBe(true)
    expect(chosen.phase.kind).toBe('idle')
  })

  test('"discard and reload" adopts the disk version: clean, at the disk mtime', () => {
    const reloaded = run(
      OPENED, { kind: 'edited' }, { kind: 'save-started' },
      { kind: 'conflicted', diskContent: 'theirs', diskMtimeMs: 5000 },
      { kind: 'take-disk' },
    )
    expect(reloaded.mtimeMs).toBe(5000)
    expect(isDirty(reloaded)).toBe(false)
    expect(reloaded.phase.kind).toBe('idle')
  })

  test('neither choice does anything when there is no conflict to resolve', () => {
    const dirty = run(OPENED, { kind: 'edited' })
    expect(run(dirty, { kind: 'keep-mine' })).toBe(dirty)
    expect(run(dirty, { kind: 'take-disk' })).toBe(dirty)
    expect(diskVersionOf(dirty.phase)).toBeNull()
  })

  test('only the "Saved" notice expires; a FAILURE stays until something really changes', () => {
    const saved = run(OPENED, { kind: 'edited' }, { kind: 'save-started' }, { kind: 'saved', mtimeMs: 2 })
    expect(run(saved, { kind: 'notice-cleared' }).phase.kind).toBe('idle')
    const failed = run(OPENED, { kind: 'edited' }, { kind: 'save-started' }, { kind: 'save-failed', text: 'x' })
    expect(run(failed, { kind: 'notice-cleared' }).phase.kind).toBe('failed')
    const conflicted = run(
      OPENED, { kind: 'edited' }, { kind: 'save-started' },
      { kind: 'conflicted', diskContent: 'a', diskMtimeMs: 3 },
    )
    expect(run(conflicted, { kind: 'notice-cleared' }).phase.kind).toBe('conflict')
  })

  test('re-reading the file resets everything, including an open question', () => {
    const messy = run(
      OPENED, { kind: 'edited' }, { kind: 'save-started' },
      { kind: 'conflicted', diskContent: 'theirs', diskMtimeMs: 5000 },
    )
    expect(run(messy, { kind: 'loaded', mtimeMs: 7777 })).toEqual(initialSaveState(7777))
  })
})

// --- the gate ------------------------------------------------------------------------------------

describe('saveGate', () => {
  const dirty = run(OPENED, { kind: 'edited' })

  test('a clean buffer writes nothing — there is nothing to write', () => {
    expect(saveGate(OPENED)).toEqual({ allowed: false, why: 'clean' })
  })

  test('a write in flight blocks a second one', () => {
    expect(saveGate(run(dirty, { kind: 'save-started' }))).toEqual({ allowed: false, why: 'in-flight' })
  })

  test('an OPEN question blocks every write, whoever asks', () => {
    const conflicted = run(dirty, { kind: 'save-started' }, { kind: 'conflicted', diskContent: 'x', diskMtimeMs: 2 })
    expect(saveGate(conflicted)).toEqual({ allowed: false, why: 'conflict-open' })
  })

  test('a pin known to be STALE blocks it too, with its own reason', () => {
    const stale = run(
      dirty, { kind: 'save-started' },
      { kind: 'conflicted', diskContent: 'x', diskMtimeMs: 2 }, { kind: 'dismiss-conflict' },
    )
    expect(saveGate(stale)).toEqual({ allowed: false, why: 'stale' })
  })

  test('the pin a write carries is the state’s own — never a fresher one', () => {
    expect(saveGate(dirty)).toEqual({ allowed: true, mtimeMs: 1000 })
  })
})

// --- one write result, one event ------------------------------------------------------------------

describe('saveEventFor', () => {
  test('a success carries the NEW mtime the next write must be pinned to', () => {
    expect(saveEventFor({ ok: true, mtimeMs: 4242 }, 'en')).toEqual({ kind: 'saved', mtimeMs: 4242 })
  })

  test('a 409 carrying the disk version becomes the question', () => {
    const conflict: WriteFileResult = {
      ok: false, failure: 'refused', status: 409, reason: 'conflict',
      message: 'This file changed on disk.', content: 'theirs', mtimeMs: 5000,
    }
    expect(saveEventFor(conflict, 'en'))
      .toEqual({ kind: 'conflicted', diskContent: 'theirs', diskMtimeMs: 5000 })
  })

  test('a 409 that names a conflict WITHOUT the content it needs is a failure, not a prompt', () => {
    // `isWriteConflict` is the test, never `reason === 'conflict'`: a dialog offering "reload what is
    // on disk" with no disk content would be a button that cannot do what it says.
    const half: WriteFileResult = {
      ok: false, failure: 'refused', status: 409, reason: 'conflict',
      message: 'O arquivo mudou no disco.',
    } as WriteFileResult
    expect(saveEventFor(half, 'pt')).toEqual({ kind: 'save-failed', text: 'O arquivo mudou no disco.' })
  })

  test('any other refusal is the server’s own sentence', () => {
    expect(saveEventFor({
      ok: false, failure: 'refused', status: 403, reason: 'escaped',
      message: 'Esse caminho sai da pasta da sessão.',
    }, 'pt')).toEqual({ kind: 'save-failed', text: 'Esse caminho sai da pasta da sessão.' })
  })

  test('an unreachable server is a failure with a sentence, never a silent no-op', () => {
    const event = saveEventFor({ ok: false, failure: 'unreachable', cause: 'network' }, 'en')
    expect(event.kind).toBe('save-failed')
    expect(event.kind === 'save-failed' && event.text.length > 0).toBe(true)
  })
})

// --- what the reader is told ---------------------------------------------------------------------

describe('saveStatus', () => {
  const dirty = run(OPENED, { kind: 'edited' })
  const saving = run(dirty, { kind: 'save-started' })
  const saved = run(saving, { kind: 'saved', mtimeMs: 2 })
  const failed = run(saving, { kind: 'save-failed', text: 'The server did not answer.' })
  const conflicted = run(saving, { kind: 'conflicted', diskContent: 'x', diskMtimeMs: 2 })
  const stale = run(conflicted, { kind: 'dismiss-conflict' })

  test('a buffer that matches the disk says NOTHING — it invents no reassurance', () => {
    expect(saveStatus(OPENED, 'en')).toEqual({ text: null, tone: 'dim' })
  })

  test('the five things that can be happening are five different sentences', () => {
    const seen = [dirty, saving, saved, failed, conflicted]
      .map(state => saveStatus(state, 'en').text)
    expect(new Set(seen).size).toBe(5)
    expect(seen.every(text => text !== null)).toBe(true)
  })

  test('a failed save shows the server’s own sentence, verbatim', () => {
    expect(saveStatus(failed, 'en')).toEqual({ text: 'The server did not answer.', tone: 'bad' })
  })

  test('a conflict and a stale pin are never drawn as "Saved"', () => {
    for (const state of [conflicted, stale]) {
      const status = saveStatus(state, 'en')
      expect(status.tone).toBe('warn')
      expect(status.text).toContain('Not saved')
    }
  })

  test('a save that landed while the reader kept typing reads as UNSAVED, not as Saved', () => {
    const typedDuring = run(dirty, { kind: 'save-started' }, { kind: 'edited' }, { kind: 'saved', mtimeMs: 2 })
    expect(saveStatus(typedDuring, 'en').text).toBe('Unsaved changes')
  })

  test('every sentence is localized, and the two languages differ', () => {
    for (const state of [dirty, saving, saved, conflicted, stale]) {
      expect(saveStatus(state, 'en').text).not.toBe(saveStatus(state, 'pt').text)
    }
  })
})

describe('saveButtonState', () => {
  const dirty = run(OPENED, { kind: 'edited' })

  test('pressable when there is something to write, and it names the shortcut on a desktop', () => {
    expect(saveButtonState(dirty, 'en', false)).toEqual({ enabled: true, title: 'Save (Ctrl+S)' })
  })

  test('a phone has no Ctrl key, so it is not offered one', () => {
    expect(saveButtonState(dirty, 'en', true)).toEqual({ enabled: true, title: 'Save' })
  })

  test('every refusal to write has its OWN sentence — a dead control explains itself', () => {
    const saving = run(dirty, { kind: 'save-started' })
    const conflicted = run(saving, { kind: 'conflicted', diskContent: 'x', diskMtimeMs: 2 })
    const titles = [OPENED, saving, conflicted].map(s => saveButtonState(s, 'en', false).title)
    expect(new Set(titles).size).toBe(3)
    expect(titles.every(t => t.length > 0)).toBe(true)
    expect([OPENED, saving, conflicted].map(s => saveButtonState(s, 'en', false).enabled))
      .toEqual([false, false, false])
  })

  test('a STALE pin keeps the button live — pressing it re-asks the question', () => {
    const stale = run(
      dirty, { kind: 'save-started' },
      { kind: 'conflicted', diskContent: 'x', diskMtimeMs: 2 }, { kind: 'dismiss-conflict' },
    )
    const button = saveButtonState(stale, 'en', false)
    expect(button.enabled).toBe(true)
    expect(button.title).toContain('changed on disk')
  })
})

// --- Monaco’s own decisions ----------------------------------------------------------------------

describe('monacoThemeFor', () => {
  test('reads the one place the app records its theme', () => {
    expect(monacoThemeFor('light')).toBe('vs')
    expect(monacoThemeFor('dark')).toBe('vs-dark')
  })

  test('an absent attribute is the theme this app ships with, not a light editor on a dark page', () => {
    expect(monacoThemeFor(null)).toBe('vs-dark')
    expect(monacoThemeFor('')).toBe('vs-dark')
  })
})

describe('monacoOptions — the narrow-column decisions, pinned', () => {
  const phone = monacoOptions({ isMobile: true, theme: 'vs-dark' })
  const desk = monacoOptions({ isMobile: false, theme: 'vs' })

  test('word wrap is on at EVERY width — this editor never gets a window’s width', () => {
    expect(phone.wordWrap).toBe('on')
    expect(desk.wordWrap).toBe('on')
    expect(phone.scrollbar?.horizontal).toBe('hidden')
  })

  test('line numbers survive the phone — they are how a searched line is confirmed', () => {
    expect(phone.lineNumbers).not.toBe('off')
    expect((phone.lineNumbersMinChars ?? 0) > 0).toBe(true)
  })

  test('what the phone gives up is the gutter furniture, not the text', () => {
    expect(phone.folding).toBe(false)
    expect(desk.folding).toBe(true)
    expect(phone.overviewRulerLanes).toBe(0)
    expect(phone.contextmenu).toBe(false)
    expect(phone.quickSuggestions).toBe(false)
    expect((phone.fontSize ?? 0) >= 14).toBe(true)
  })

  test('no minimap anywhere, and the theme is the one it was given', () => {
    expect(phone.minimap?.enabled).toBe(false)
    expect(desk.minimap?.enabled).toBe(false)
    expect(desk.theme).toBe('vs')
    expect(phone.theme).toBe('vs-dark')
  })
})

// --- the strip, the banner and the question, as markup -------------------------------------------

const DIRTY = run(OPENED, { kind: 'edited' })
const SAVING = run(DIRTY, { kind: 'save-started' })
const CONFLICTED = run(SAVING, { kind: 'conflicted', diskContent: 'theirs', diskMtimeMs: 5000 })

function strip(state: SaveState, lang: 'pt' | 'en' = 'en', isMobile = false): string {
  return renderToStaticMarkup(
    <RepoSaveStrip state={state} lang={lang} isMobile={isMobile} onSave={noop} />,
  )
}

describe('the save strip', () => {
  test('a dirty buffer is VISIBLY dirty, and a clean one is not', () => {
    expect(strip(DIRTY)).toContain('data-dirty="true"')
    expect(strip(OPENED)).toContain('data-dirty="false"')
  })

  test('the status is announced rather than left for the eye to find', () => {
    expect(strip(DIRTY)).toContain('role="status"')
    expect(strip(DIRTY)).toContain('Unsaved changes')
  })

  test('nothing to save means a disabled button that says why', () => {
    const html = strip(OPENED)
    expect(html).toContain('disabled=""')
    expect(html).toContain('matches the version on disk')
  })

  test('something to save means a live button naming the shortcut', () => {
    const html = strip(DIRTY)
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('Ctrl+S')
  })

  test('a save in flight says so and cannot be pressed again', () => {
    const html = strip(SAVING)
    expect(html).toContain('Saving')
    expect(html).toContain('disabled=""')
  })

  test('a 44px target on a phone, dense on a desktop', () => {
    expect(strip(DIRTY, 'en', true)).toContain('min-height:44px')
    expect(strip(DIRTY, 'en', false)).not.toContain('min-height:44px')
  })

  test('localized, and the two languages differ', () => {
    for (const state of [OPENED, DIRTY, SAVING, CONFLICTED]) {
      expect(strip(state, 'en')).not.toBe(strip(state, 'pt'))
    }
  })
})

describe('the stale banner', () => {
  function banner(autosave: boolean, lang: 'pt' | 'en' = 'en', isMobile = false): string {
    return renderToStaticMarkup(
      <RepoStaleBanner
        lang={lang} isMobile={isMobile} autosave={autosave} onResave={noop} onDiscard={noop}
      />,
    )
  }

  test('it states the fact and keeps BOTH resolving actions one press away', () => {
    const html = banner(false)
    expect(html).toContain('changed on disk')
    expect(html).toContain('Nothing has been saved')
    expect(html).toContain('Save over it')
    expect(html).toContain('Discard and reload')
  })

  test('a reader who trusts autosave is TOLD it has stopped — and not told so when it is off', () => {
    expect(banner(true)).toContain('Autosave is paused')
    expect(banner(false)).not.toContain('Autosave is paused')
    expect(banner(true, 'pt')).toContain('automático está pausado')
  })

  test('44px targets on a phone', () => {
    expect(banner(true, 'en', true)).toContain('min-height:44px')
    expect(banner(true, 'en', false)).not.toContain('min-height:44px')
  })
})

describe('the conflict question', () => {
  function prompt(lang: 'pt' | 'en' = 'en', isMobile = false, autosave = false): string {
    return renderToStaticMarkup(
      <RepoConflictPrompt
        path="packages/web/src/lib/repoApi.ts"
        lang={lang}
        isMobile={isMobile}
        autosave={autosave}
        onResave={noop}
        onDiscard={noop}
        onDismiss={noop}
      />,
    )
  }

  test('it is a dialog, and it names the file it is about', () => {
    const html = prompt()
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('packages/web/src/lib/repoApi.ts')
  })

  test('it says plainly that NOTHING was saved', () => {
    expect(prompt()).toContain('Nothing was saved')
    expect(prompt('pt')).toContain('Nada foi salvo')
  })

  test('THREE answers, each naming what it costs', () => {
    const html = prompt()
    expect(html).toContain('Save over it')
    expect(html).toContain('replaces the version that is on disk now')
    expect(html).toContain('Discard and reload')
    expect(html).toContain('Throws away what you typed')
    expect(html).toContain('Keep editing')
    expect(html).toContain('Decide later')
  })

  test('no answer is pre-selected or dressed as the safe one — both of them lose something', () => {
    const html = prompt()
    expect(html).not.toContain('autofocus')
    // The three choices are the same control, so none of them reads as the default.
    expect((html.match(/background:var\(--bg-elevated\)/g) ?? []).length).toBe(3)
  })

  test('"keep editing" mentions the paused autosave only when autosave is actually on', () => {
    expect(prompt('en', false, true)).toContain('autosave stays paused')
    expect(prompt('en', false, false)).not.toContain('autosave stays paused')
  })

  test('44px targets on a phone, and the dialog contains its own overscroll', () => {
    expect(prompt('en', true)).toContain('min-height:44px')
    expect(prompt('en')).toContain('overscroll-behavior:contain')
  })

  test('localized, and the two languages differ', () => {
    expect(prompt('en')).not.toBe(prompt('pt'))
  })
})

// --- THE GUARANTEE, against a fake disk that behaves exactly like the server ----------------------

/**
 * The server's own contract, in eight lines: a write lands only if the pin it carries still matches
 * the file's mtime; otherwise NOTHING is written and the refusal carries the current content and
 * mtime. Asserting against `disk` afterwards is what makes these tests about the file rather than
 * about the UI's opinion of it.
 */
function fakeDisk(content: string, mtimeMs: number) {
  const disk = { content, mtimeMs }
  return {
    disk,
    /** Somebody else — an agent, a terminal — writes to the file. */
    writtenByAnother(next: string) {
      disk.content = next
      disk.mtimeMs += 1000
    },
    write(pin: number, next: string): WriteFileResult {
      if (pin !== disk.mtimeMs) {
        return {
          ok: false, failure: 'refused', status: 409, reason: 'conflict',
          message: 'This file changed on disk.', content: disk.content, mtimeMs: disk.mtimeMs,
        }
      }
      disk.content = next
      disk.mtimeMs += 1000
      return { ok: true, mtimeMs: disk.mtimeMs }
    },
  }
}

/**
 * The component's own wiring, minus React: every save — Ctrl+S or the autosave timer — goes through
 * `saveGate`, and the result becomes an event through `saveEventFor`. Nothing here is a
 * test-only shortcut; these are the same four functions `RepoFileEditor` calls, in the same order.
 */
function driver(initialContent: string, initialMtime: number) {
  const fake = fakeDisk(initialContent, initialMtime)
  let state = initialSaveState(initialMtime)
  let buffer = initialContent
  const attempts: number[] = []

  const write = (pin: number) => {
    attempts.push(pin)
    state = nextSaveState(state, { kind: 'save-started' })
    state = nextSaveState(state, saveEventFor(fake.write(pin, buffer), 'en'))
  }

  return {
    fake,
    attempts,
    get state() { return state },
    get buffer() { return buffer },
    type(text: string) {
      buffer = text
      state = nextSaveState(state, { kind: 'edited' })
    },
    save(trigger: 'explicit' | 'auto') {
      const gate = saveGate(state)
      if (!gate.allowed) {
        if (gate.why === 'stale' && trigger === 'explicit') {
          state = nextSaveState(state, { kind: 'prompt-conflict' })
        }
        return
      }
      write(gate.mtimeMs)
    },
    resaveOverDisk() {
      const version = diskVersionOf(state.phase)
      if (version === null) return
      state = nextSaveState(state, { kind: 'keep-mine' })
      write(version.diskMtimeMs)
    },
    discardAndReload() {
      const version = diskVersionOf(state.phase)
      if (version === null) return
      buffer = version.diskContent
      state = nextSaveState(state, { kind: 'take-disk' })
    },
    keepEditing() { state = nextSaveState(state, { kind: 'dismiss-conflict' }) },
  }
}

describe('a save never silently overwrites somebody else’s change', () => {
  test('the ordinary case still works: edit, save, the file holds what was typed', () => {
    const d = driver('one\n', 1000)
    d.type('one\ntwo\n')
    d.save('explicit')
    expect(d.fake.disk.content).toBe('one\ntwo\n')
    expect(d.state.mtimeMs).toBe(d.fake.disk.mtimeMs)
    expect(isDirty(d.state)).toBe(false)
  })

  test('an agent writing between the read and the save is NOT overwritten — the file keeps its change', () => {
    const d = driver('one\n', 1000)
    d.type('mine\n')
    d.fake.writtenByAnother('theirs\n')
    d.save('explicit')

    expect(d.fake.disk.content).toBe('theirs\n')          // nothing was written
    expect(d.state.phase.kind).toBe('conflict')            // and the person is being asked
    expect(diskVersionOf(d.state.phase)?.diskContent).toBe('theirs\n')
    expect(isDirty(d.state)).toBe(true)                    // their edit is still theirs to keep
  })

  test('AUTOSAVE cannot answer the question: it keeps refusing, and writes nothing', () => {
    const d = driver('one\n', 1000)
    d.type('mine\n')
    d.fake.writtenByAnother('theirs\n')
    d.save('auto')                                          // the autosave timer fires, and conflicts
    expect(d.attempts.length).toBe(1)

    for (let i = 0; i < 20; i++) d.save('auto')             // every later tick, for as long as it sits
    expect(d.attempts.length).toBe(1)
    expect(d.fake.disk.content).toBe('theirs\n')
    expect(d.state.phase.kind).toBe('conflict')
  })

  test('an autosave tick cannot resolve it after "keep editing" either', () => {
    const d = driver('one\n', 1000)
    d.type('mine\n')
    d.fake.writtenByAnother('theirs\n')
    d.save('auto')
    d.keepEditing()

    d.type('mine again\n')                                  // still editing, autosave still on
    for (let i = 0; i < 20; i++) d.save('auto')
    expect(d.attempts.length).toBe(1)
    expect(d.fake.disk.content).toBe('theirs\n')
    expect(d.state.phase.kind).toBe('stale')
  })

  test('an explicit Ctrl+S after "keep editing" re-asks rather than writing', () => {
    const d = driver('one\n', 1000)
    d.type('mine\n')
    d.fake.writtenByAnother('theirs\n')
    d.save('explicit')
    d.keepEditing()

    d.save('explicit')
    expect(d.attempts.length).toBe(1)                       // no second write
    expect(d.state.phase.kind).toBe('conflict')             // the question, asked again
    expect(d.fake.disk.content).toBe('theirs\n')
  })

  test('"save over it" is the ONLY thing that overwrites, and it takes a person to press it', () => {
    const d = driver('one\n', 1000)
    d.type('mine\n')
    d.fake.writtenByAnother('theirs\n')
    d.save('explicit')
    expect(d.fake.disk.content).toBe('theirs\n')

    d.resaveOverDisk()
    expect(d.fake.disk.content).toBe('mine\n')
    expect(d.state.phase.kind).toBe('saved')
    expect(d.state.mtimeMs).toBe(d.fake.disk.mtimeMs)
    expect(isDirty(d.state)).toBe(false)
  })

  test('a SECOND change arriving while the question is open conflicts again, rather than being lost', () => {
    const d = driver('one\n', 1000)
    d.type('mine\n')
    d.fake.writtenByAnother('theirs\n')
    d.save('explicit')

    // The agent writes AGAIN while the dialog sits there, so the mtime the refusal reported is
    // itself already out of date.
    d.fake.writtenByAnother('theirs again\n')
    d.resaveOverDisk()

    expect(d.fake.disk.content).toBe('theirs again\n')      // still not overwritten
    expect(d.state.phase.kind).toBe('conflict')             // asked again, with the newer version
    expect(diskVersionOf(d.state.phase)?.diskContent).toBe('theirs again\n')

    // …and pressing it once more, now against the version it was actually shown, lands.
    d.resaveOverDisk()
    expect(d.fake.disk.content).toBe('mine\n')
    expect(d.state.phase.kind).toBe('saved')
  })

  test('"discard and reload" takes the other version, and the next save is clean against it', () => {
    const d = driver('one\n', 1000)
    d.type('mine\n')
    d.fake.writtenByAnother('theirs\n')
    d.save('explicit')

    d.discardAndReload()
    expect(d.buffer).toBe('theirs\n')
    expect(isDirty(d.state)).toBe(false)
    expect(d.state.mtimeMs).toBe(d.fake.disk.mtimeMs)

    d.type('theirs\nplus mine\n')
    d.save('explicit')
    expect(d.fake.disk.content).toBe('theirs\nplus mine\n')
    expect(d.state.phase.kind).toBe('saved')
  })

  test('a save nobody asked for never happens: a clean buffer writes nothing, ever', () => {
    const d = driver('one\n', 1000)
    for (let i = 0; i < 10; i++) { d.save('auto'); d.save('explicit') }
    expect(d.attempts).toEqual([])
    expect(d.fake.disk.mtimeMs).toBe(1000)
  })
})
