/**
 * RepoFileEditor — ONE open file: Monaco over its text, and a save that can never silently
 * overwrite a change that landed while the file was open. That last clause is the whole reason the
 * repository explorer is allowed to WRITE at all, so it is stated as an invariant rather than left
 * as behaviour:
 *
 *   **THE BASELINE MOVES ONLY ON A FACT, OR ON A PERSON'S EXPLICIT CHOICE.** Every write is PINNED
 *   to `SaveState.mtimeMs` — the mtime the buffer on screen was READ at. The server compares that
 *   pin against the file immediately before writing and refuses outright (409, nothing written)
 *   when they differ, answering with the CURRENT content and mtime. Exactly three things may move
 *   the pin: a successful write (the server states the new mtime), adopting the disk version
 *   (`take-disk`), and a person choosing to write over it (`keep-mine`). A refusal never moves it —
 *   advancing the pin on a 409 would turn the next save into the blind overwrite this feature
 *   exists to prevent.
 *
 * THE STATE MACHINE IS PURE AND LIVES HERE (`nextSaveState` / `saveGate` / `saveEventFor`), the
 * same split `RepoSearchView` makes for its debounce: this repo has no jsdom and no
 * `@testing-library/react` (see `ConnectionCard.test.tsx`'s own note), so the only way a transition
 * can be ASSERTED rather than believed is for it to be a function. `RepoFileEditor.test.tsx` drives
 * every one of them, including the two that are easy to get wrong: an AUTOSAVE that meets a
 * conflict, and a SECOND conflict after the person chose to save over the first.
 *
 * THE CONFLICT IS A QUESTION, AND A QUESTION HAS NO DEFAULT ANSWER. Nothing is written, reloaded or
 * merged on its own. The person is offered three things and every one of them is theirs to pick:
 * write over the new version, throw away their own edit and take the new version, or keep editing
 * and decide later. "Decide later" is the `stale` phase, which is NOT the same as dismissing the
 * problem: the pin is known to be old, so autosave STOPS (it would otherwise re-raise this dialog
 * every second and a half) and a banner keeps both resolving actions one press away. An explicit
 * Ctrl+S while stale re-asks the question instead of writing.
 *
 * FIVE FACTS, FIVE SENTENCES — the rule this product applies to harness capabilities, applied to a
 * file: still loading, a read that was refused, a BINARY file (never opened as text), a save that
 * failed, and a conflict. Each has its own wording; none of them is a shared empty box, and the
 * refusals are the SERVER'S OWN sentence wherever it wrote one (`repoErrorText.ts` supplies one
 * only for the failures that arrive carrying none).
 *
 * `monacoSetup` IS IMPORTED DYNAMICALLY, and that is load-bearing. Its own header says it must only
 * ever be reached that way — it statically imports five `?worker` wrappers, and this component is
 * reached from `ArtifactsAside`, i.e. from the main bundle. A static `import { loadMonaco }` here
 * would put Monaco's linkage in the entry chunk and undo the lazy guarantee Task 4 measured, and no
 * test would notice.
 */

import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, File, Loader, RotateCcw, Save } from 'lucide-react'
import type * as Monaco from 'monaco-editor'
import { languageForPath } from '../../lib/monacoLanguage'
import {
  isWriteConflict, readRepoFile, writeRepoFile,
  type ReadFileResult, type RepoLang, type WriteFileResult,
} from '../../lib/repoApi'
import { repoFailureText } from '../../lib/repoErrorText'
import { formatBytes } from '../../lib/gallery'
import { useIsMobile } from '../../hooks/useIsMobile'
import { RepoNote } from './repoNote'

type MonacoModule = typeof import('monaco-editor')

export interface RepoFileEditorProps {
  sessionId: string
  path: string
  /** The user's own autosave preference — off by default; see `Preferences.editorAutosave`. */
  autosave: boolean
  onDirtyChange: (dirty: boolean) => void
  lang: 'pt' | 'en'
  /** Set when the file was opened FROM a content-search hit; re-set when another hit re-opens it. */
  gotoLine?: number
}

// --- loading one file ----------------------------------------------------------------------------

/**
 * What is on screen before the editor can be. `binary` is a SUCCESS, not a failure: the read route
 * answers `{binary: true, name, size}` and no text, and a binary file is not an empty one.
 */
export type LoadState =
  | { kind: 'loading' }
  | { kind: 'binary'; name: string; size: number }
  | { kind: 'failed'; text: string }
  | { kind: 'ready'; content: string; mtimeMs: number }

export function loadStateFor(res: ReadFileResult, lang: RepoLang): LoadState {
  if (!res.ok) return { kind: 'failed', text: repoFailureText(res, lang) }
  if (res.binary === true) return { kind: 'binary', name: res.name, size: res.size }
  return { kind: 'ready', content: res.content, mtimeMs: res.mtimeMs }
}

/**
 * A binary file, said in one sentence.
 *
 * The SIZE goes through `formatBytes` (`lib/gallery.ts`) rather than a fourth hand-rolled byte
 * formatter — it is already pure, already tested, and already shows nothing rather than `0 B` for a
 * count it does not have, which is the same rule this file follows everywhere else.
 */
export function binaryText(file: { name: string; size: number }, lang: RepoLang): string {
  const size = formatBytes(file.size)
  const where = size === '' ? file.name : `${file.name} · ${size}`
  return lang === 'pt'
    ? `${where} — arquivo binário. Ele não é aberto como texto aqui, para não ser salvo corrompido.`
    : `${where} — binary file. It is not opened as text here, so it cannot be saved back mangled.`
}

// --- the save state machine ----------------------------------------------------------------------

/**
 * What the save is DOING, and — for the two phases that carry it — the version that is on disk.
 *
 * `conflict` and `stale` are the SAME fact in two presentations: the question is open (a modal), or
 * the person asked to decide later (a banner, autosave stopped). Both keep the disk version so
 * either resolving action stays available without a second read.
 */
export type SavePhase =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'failed'; text: string }
  | { kind: 'conflict'; diskContent: string; diskMtimeMs: number }
  | { kind: 'stale'; diskContent: string; diskMtimeMs: number }

export interface SaveState {
  /** The version every write is pinned to: the mtime the buffer's baseline was read at. */
  mtimeMs: number
  /** Bumped by every edit the PERSON made. */
  editSeq: number
  /** The edit the last ACCEPTED write carried. `editSeq === savedSeq` is "nothing unsaved". */
  savedSeq: number
  /**
   * The edit the in-flight write carries, or `null`. It exists so that typing DURING a save leaves
   * the buffer dirty afterwards: the write carried the older text, and reporting it as saved would
   * be the one lie a dirty dot is there to prevent.
   */
  inFlightSeq: number | null
  phase: SavePhase
}

export type SaveEvent =
  /** The file was (re-)read: a fresh baseline, nothing unsaved, no phase. */
  | { kind: 'loaded'; mtimeMs: number }
  | { kind: 'edited' }
  | { kind: 'save-started' }
  | { kind: 'saved'; mtimeMs: number }
  | { kind: 'conflicted'; diskContent: string; diskMtimeMs: number }
  | { kind: 'save-failed'; text: string }
  /** "Keep editing" — the question is closed, the pin is KNOWN stale, autosave stops. */
  | { kind: 'dismiss-conflict' }
  /** An explicit save over a stale pin re-opens the question rather than writing. */
  | { kind: 'prompt-conflict' }
  /** "Save over it" — the one event that moves the pin without adopting the disk text. */
  | { kind: 'keep-mine' }
  /** "Discard and reload" — the buffer becomes the disk version, so it is clean at that mtime. */
  | { kind: 'take-disk' }
  | { kind: 'notice-cleared' }

export function initialSaveState(mtimeMs: number): SaveState {
  return { mtimeMs, editSeq: 0, savedSeq: 0, inFlightSeq: null, phase: { kind: 'idle' } }
}

export function isDirty(state: SaveState): boolean {
  return state.editSeq !== state.savedSeq
}

/** The disk version a conflict carries, or `null` when there is no open conflict to resolve. */
export function diskVersionOf(phase: SavePhase): { diskContent: string; diskMtimeMs: number } | null {
  return phase.kind === 'conflict' || phase.kind === 'stale'
    ? { diskContent: phase.diskContent, diskMtimeMs: phase.diskMtimeMs }
    : null
}

/**
 * What an EDIT does to the phase.
 *
 * An open question survives typing: a conflict dialog that a keystroke dismisses is a question
 * answered by accident. `saved` and `failed` are notices ABOUT a write, and the buffer has just
 * moved past it, so they go. The SAME object is returned when nothing changes, which is what lets
 * the notice timer depend on the phase's identity.
 */
function phaseAfterEdit(phase: SavePhase): SavePhase {
  return phase.kind === 'saved' || phase.kind === 'failed' ? { kind: 'idle' } : phase
}

export function nextSaveState(state: SaveState, event: SaveEvent): SaveState {
  switch (event.kind) {
    case 'loaded':
      return initialSaveState(event.mtimeMs)

    case 'edited':
      return { ...state, editSeq: state.editSeq + 1, phase: phaseAfterEdit(state.phase) }

    case 'save-started':
      return { ...state, inFlightSeq: state.editSeq, phase: { kind: 'saving' } }

    case 'saved':
      return {
        ...state,
        mtimeMs: event.mtimeMs,
        savedSeq: state.inFlightSeq ?? state.savedSeq,
        inFlightSeq: null,
        phase: { kind: 'saved' },
      }

    // NOTHING WAS WRITTEN, so `savedSeq` does not move — and neither does the pin. See the header.
    case 'conflicted':
      return {
        ...state,
        inFlightSeq: null,
        phase: { kind: 'conflict', diskContent: event.diskContent, diskMtimeMs: event.diskMtimeMs },
      }

    case 'save-failed':
      return { ...state, inFlightSeq: null, phase: { kind: 'failed', text: event.text } }

    case 'dismiss-conflict':
      return state.phase.kind === 'conflict'
        ? { ...state, phase: { ...state.phase, kind: 'stale' } }
        : state

    case 'prompt-conflict':
      return state.phase.kind === 'stale'
        ? { ...state, phase: { ...state.phase, kind: 'conflict' } }
        : state

    // The person chose to write over the new version: the pin becomes the one the refusal reported,
    // so the write is accepted — unless the file changed AGAIN since, which conflicts again.
    case 'keep-mine': {
      const disk = diskVersionOf(state.phase)
      return disk === null ? state : { ...state, mtimeMs: disk.diskMtimeMs, phase: { kind: 'idle' } }
    }

    // The buffer IS the disk version now, so it is clean at that mtime. The caller is responsible
    // for having actually put that text in the editor — `discardAndReload` below never dispatches
    // this without having done so.
    case 'take-disk': {
      const disk = diskVersionOf(state.phase)
      return disk === null
        ? state
        : { ...state, mtimeMs: disk.diskMtimeMs, savedSeq: state.editSeq, phase: { kind: 'idle' } }
    }

    // Only the transient "Saved" notice expires. A FAILURE stays on screen until the buffer or the
    // save state actually changes — a sentence that fades is a sentence nobody read.
    case 'notice-cleared':
      return state.phase.kind === 'saved' ? { ...state, phase: { kind: 'idle' } } : state
  }
}

/**
 * May a write be attempted right now, and pinned to what? The ONE gate both Ctrl+S and the autosave
 * timer go through, which is what makes "autosave cannot resolve a conflict" structural rather than
 * a thing each caller remembers.
 */
export type SaveGate =
  | { allowed: true; mtimeMs: number }
  | { allowed: false; why: 'clean' | 'in-flight' | 'conflict-open' | 'stale' }

export function saveGate(state: SaveState): SaveGate {
  if (state.phase.kind === 'conflict') return { allowed: false, why: 'conflict-open' }
  if (state.phase.kind === 'stale') return { allowed: false, why: 'stale' }
  if (state.phase.kind === 'saving') return { allowed: false, why: 'in-flight' }
  if (!isDirty(state)) return { allowed: false, why: 'clean' }
  return { allowed: true, mtimeMs: state.mtimeMs }
}

/**
 * One write result, one event.
 *
 * `isWriteConflict` — never a bare `reason === 'conflict'` — is what keeps the dialog honest: a 409
 * that names a conflict but carries no content could not offer "reload what is on disk", so it
 * falls through to the server's own sentence instead of a prompt whose buttons would lie.
 */
export function saveEventFor(res: WriteFileResult, lang: RepoLang): SaveEvent {
  if (res.ok) return { kind: 'saved', mtimeMs: res.mtimeMs }
  if (isWriteConflict(res)) {
    return { kind: 'conflicted', diskContent: res.content, diskMtimeMs: res.mtimeMs }
  }
  return { kind: 'save-failed', text: repoFailureText(res, lang) }
}

// --- what the save strip says --------------------------------------------------------------------

export type SaveTone = 'dim' | 'busy' | 'ok' | 'warn' | 'bad'
export interface SaveStatus { text: string | null; tone: SaveTone }

/**
 * The one-line status beside the Save button. `null` is a real answer: a buffer that matches the
 * disk and has nothing to report says nothing, rather than inventing reassurance.
 *
 * The ORDER is the point. A failure outranks "unsaved changes" (both are true; only one tells you
 * why), and a conflict outranks both — and neither of those may ever be drawn as "Saved".
 */
export function saveStatus(state: SaveState, lang: RepoLang): SaveStatus {
  const pt = lang === 'pt'
  switch (state.phase.kind) {
    case 'saving':
      return { text: pt ? 'Salvando…' : 'Saving…', tone: 'busy' }
    case 'conflict':
    case 'stale':
      return {
        text: pt ? 'Não salvo — o arquivo mudou no disco.' : 'Not saved — this file changed on disk.',
        tone: 'warn',
      }
    case 'failed':
      return { text: state.phase.text, tone: 'bad' }
    default:
      if (isDirty(state)) return { text: pt ? 'Não salvo' : 'Unsaved changes', tone: 'dim' }
      return state.phase.kind === 'saved'
        ? { text: pt ? 'Salvo' : 'Saved', tone: 'ok' }
        : { text: null, tone: 'dim' }
  }
}

/**
 * The Save button: whether it does anything, and what it says when it does not.
 *
 * A disabled control that explains nothing is indistinguishable from a broken one, so every refusal
 * has its own sentence — and the STALE one is deliberately ENABLED: pressing it re-asks the
 * question, which is the one useful thing left to do over a pin that is known to be old.
 */
export function saveButtonState(state: SaveState, lang: RepoLang, isMobile: boolean): {
  enabled: boolean
  title: string
} {
  const pt = lang === 'pt'
  const gate = saveGate(state)
  if (gate.allowed) {
    const plain = pt ? 'Salvar' : 'Save'
    return { enabled: true, title: isMobile ? plain : `${plain} (Ctrl+S)` }
  }
  switch (gate.why) {
    case 'clean':
      return {
        enabled: false,
        title: pt
          ? 'Nada para salvar — este arquivo está igual à versão no disco.'
          : 'Nothing to save — this file matches the version on disk.',
      }
    case 'in-flight':
      return { enabled: false, title: pt ? 'Salvando…' : 'Saving…' }
    case 'conflict-open':
      return {
        enabled: false,
        title: pt
          ? 'Responda primeiro o que fazer com a mudança que apareceu no disco.'
          : 'First answer what should happen to the change that appeared on disk.',
      }
    case 'stale':
      return {
        enabled: true,
        title: pt
          ? 'O arquivo mudou no disco — toque para escolher o que fazer.'
          : 'This file changed on disk — press to choose what to do.',
      }
  }
}

/** `vs` or `vs-dark`, from the one place the app records the theme: `<html data-theme>`. */
export function monacoThemeFor(attr: string | null): 'vs' | 'vs-dark' {
  return attr === 'light' ? 'vs' : 'vs-dark'
}

/**
 * Monaco's options, and the DELIBERATE DECISION about a 390px column.
 *
 * This editor never gets a window's width: it lives in an aside a reader drags between roughly 280
 * and 900px, and on a phone it IS 390px. So:
 *
 * - **Word wrap is on at every width.** A horizontal scrollbar inside a 390px column makes code
 *   unreadable (and the panel must not scroll sideways at all, which `CLAUDE.md` requires).
 * - **Line numbers stay, everywhere.** They are how a reader confirms a content-search hit opened
 *   where it claimed to; trading them for ~30px would make `gotoLine` unverifiable by eye.
 * - **Everything else in the gutter goes on a phone** — folding, the overview ruler, the current
 *   line highlight, the suggest widget and the context menu (a long press there fights the native
 *   selection UI). What is left is the number, the text, and a 14px font that can actually be read.
 * - **The editor is SHOWN on a phone rather than refused.** Monaco's touch support is imperfect but
 *   real, and a read-only fallback would make the Repository tab a different feature on a phone —
 *   what a phone genuinely cannot do is Ctrl+S, which is why the Save button exists beside it.
 */
export function monacoOptions({ isMobile, theme }: { isMobile: boolean; theme: 'vs' | 'vs-dark' }):
Monaco.editor.IEditorOptions & Monaco.editor.IGlobalEditorOptions {
  return {
    theme,
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    wrappingIndent: 'same',
    fontSize: isMobile ? 14 : 12.5,
    lineHeight: isMobile ? 21 : 18,
    lineNumbersMinChars: isMobile ? 3 : 4,
    lineDecorationsWidth: isMobile ? 2 : 8,
    folding: !isMobile,
    glyphMargin: false,
    overviewRulerLanes: isMobile ? 0 : 2,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: isMobile,
    renderLineHighlight: isMobile ? 'none' : 'line',
    quickSuggestions: !isMobile,
    contextmenu: !isMobile,
    scrollbar: {
      horizontal: 'hidden',
      vertical: 'auto',
      verticalScrollbarSize: isMobile ? 10 : 8,
      useShadows: false,
    },
    padding: { top: 6, bottom: 12 },
    renderWhitespace: 'selection',
  }
}

/** Long enough to swallow a sentence of typing, short enough that "it saves itself" stays true. */
const AUTOSAVE_DEBOUNCE_MS = 1500
/** The "Saved" notice is an acknowledgement, not a record; it goes on its own. */
const SAVED_NOTICE_MS = 1500

function readThemeAttr(): string | null {
  return typeof document === 'undefined' ? null : document.documentElement.getAttribute('data-theme')
}

export function RepoFileEditor({
  sessionId, path, autosave, onDirtyChange, lang, gotoLine,
}: RepoFileEditorProps) {
  const isMobile = useIsMobile()
  const pt = lang === 'pt'
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [save, dispatch] = useReducer(nextSaveState, initialSaveState(0))
  /**
   * The theme is read off `<html data-theme>`, the one place `App.tsx` writes it, and followed with
   * an observer rather than taken as a prop: a second copy threaded through two components would be
   * a second source for one fact, and this component's props are fixed by `RepositoryTab`.
   */
  const [themeAttr, setThemeAttr] = useState<string | null>(readThemeAttr)
  /** Bumped once the editor exists, so effects that need an instance can depend on its arrival. */
  const [mounted, setMounted] = useState(0)

  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const contentRef = useRef('')
  /**
   * True only while `setValue` is replacing the buffer with the DISK's version. Monaco fires its
   * change event synchronously from `setValue`, so without this the reload would count as an edit
   * and leave a freshly reloaded file marked dirty at the version it just adopted.
   */
  const applyingDiskRef = useRef(false)
  /**
   * A write is in flight THIS TICK. `saveGate` is the rule, but a `dispatch` lands a tick later, so
   * two Ctrl+S in one tick (Monaco's own command and the container's handler, or an impatient
   * double press) would both pass the gate, and the second would be refused as a CONFLICT with the
   * first — a prompt about nobody's change but our own.
   */
  const writingRef = useRef(false)
  const saveRef = useRef(save)
  saveRef.current = save
  const argsRef = useRef({ sessionId, path, lang: lang as RepoLang })
  argsRef.current = { sessionId, path, lang }
  const dirtyRef = useRef(false)
  const requestSaveRef = useRef<(trigger: 'explicit' | 'auto') => void>(() => {})
  const options = monacoOptions({ isMobile, theme: monacoThemeFor(themeAttr) })
  const optionsRef = useRef(options)
  optionsRef.current = options
  const mobileRef = useRef(isMobile)
  mobileRef.current = isMobile

  // --- read the file ---------------------------------------------------------
  // `lang` is NOT a dependency on purpose. It changes only the wording of a refusal, while
  // re-running this effect would re-read the file and tear the editor down — so toggling the
  // dashboard's language would silently discard an unsaved buffer.
  useEffect(() => {
    let cancelled = false
    setLoad({ kind: 'loading' })
    void readRepoFile(sessionId, path, argsRef.current.lang).then(res => {
      if (cancelled) return
      const next = loadStateFor(res, argsRef.current.lang)
      contentRef.current = next.kind === 'ready' ? next.content : ''
      if (next.kind === 'ready') dispatch({ kind: 'loaded', mtimeMs: next.mtimeMs })
      setLoad(next)
    })
    return () => { cancelled = true }
  }, [sessionId, path])

  // --- follow the app's theme -----------------------------------------------
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    const root = document.documentElement
    const observer = new MutationObserver(() => setThemeAttr(root.getAttribute('data-theme')))
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  // --- mount Monaco ----------------------------------------------------------
  // Only once there is text to show AND a host div to show it in: "do we have the file" and "is an
  // editor attached" are two questions, and letting them race is how a pane ends up blank.
  useEffect(() => {
    if (load.kind !== 'ready') return
    const host = hostRef.current
    if (host === null) return
    let disposed = false
    let model: Monaco.editor.ITextModel | null = null
    let editor: Monaco.editor.IStandaloneCodeEditor | null = null

    void import('../../lib/monacoSetup')
      .then(mod => mod.loadMonaco())
      .then((monaco: MonacoModule) => {
        if (disposed) return
        model = monaco.editor.createModel(contentRef.current, languageForPath(path))
        editor = monaco.editor.create(host, { ...optionsRef.current, model })
        editorRef.current = editor

        editor.onDidChangeModelContent(() => {
          if (applyingDiskRef.current) return
          dispatch({ kind: 'edited' })
        })
        editor.addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
          () => requestSaveRef.current('explicit'),
        )
        // Opening a file is a request to edit it — but not on a phone, where stealing focus opens
        // the soft keyboard over the file you have just asked to look at.
        if (!mobileRef.current) editor.focus()
        setMounted(n => n + 1)
      })

    return () => {
      disposed = true
      editorRef.current = null
      editor?.dispose()
      model?.dispose()
    }
  }, [load.kind, path])

  // --- keep the live editor's options current -------------------------------
  // A drag across the mobile breakpoint, or a theme toggle, must not remount the editor: that would
  // throw away an unsaved buffer to change a font size.
  useEffect(() => {
    editorRef.current?.updateOptions(options)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, themeAttr, mounted])

  // --- open at a searched line ----------------------------------------------
  useEffect(() => {
    const editor = editorRef.current
    if (editor === null || gotoLine === undefined || gotoLine <= 0) return
    editor.revealLineInCenter(gotoLine)
    editor.setPosition({ lineNumber: gotoLine, column: 1 })
  }, [gotoLine, mounted])

  // --- report dirtiness, on the EDGE ---------------------------------------
  // Monaco fires per keystroke; the parent's handler rebuilds its tab list. Reporting only when the
  // boolean actually changes is what keeps a held key from re-rendering the whole aside.
  useEffect(() => {
    const dirty = isDirty(save)
    if (dirty === dirtyRef.current) return
    dirtyRef.current = dirty
    onDirtyChange(dirty)
  }, [save, onDirtyChange])

  // --- let the "Saved" notice expire ---------------------------------------
  useEffect(() => {
    if (save.phase.kind !== 'saved') return
    const timer = setTimeout(() => dispatch({ kind: 'notice-cleared' }), SAVED_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [save.phase])

  // --- autosave ------------------------------------------------------------
  // The debounce is the effect's own cleanup: every edit produces a new state object, which restarts
  // the window. The GATE is what keeps the guarantee — a conflict or a stale pin refuses, so an
  // automatic save can never answer a question that was asked of a person.
  useEffect(() => {
    if (!autosave) return
    if (!saveGate(save).allowed) return
    const timer = setTimeout(() => requestSaveRef.current('auto'), AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [autosave, save])

  const writeNow = async (pin: number) => {
    const editor = editorRef.current
    if (editor === null || writingRef.current) return
    writingRef.current = true
    const { sessionId: id, path: file, lang: reqLang } = argsRef.current
    const content = editor.getValue()
    dispatch({ kind: 'save-started' })
    const res = await writeRepoFile(id, file, content, pin, reqLang)
    writingRef.current = false
    dispatch(saveEventFor(res, reqLang))
  }

  const requestSave = (trigger: 'explicit' | 'auto') => {
    if (writingRef.current) return
    const gate = saveGate(saveRef.current)
    if (gate.allowed) { void writeNow(gate.mtimeMs); return }
    // An explicit ask over a pin we KNOW is stale re-asks the question. An automatic one does
    // nothing at all: autosave may never be the thing that re-raises a dialog.
    if (gate.why === 'stale' && trigger === 'explicit') dispatch({ kind: 'prompt-conflict' })
  }
  requestSaveRef.current = requestSave

  /** "Save over it" — the person's own decision to overwrite the version that appeared. */
  const resaveOverDisk = () => {
    const disk = diskVersionOf(saveRef.current.phase)
    if (disk === null) return
    dispatch({ kind: 'keep-mine' })
    void writeNow(disk.diskMtimeMs)
  }

  /** "Discard and reload" — their edit goes, the disk version takes its place. */
  const discardAndReload = () => {
    const disk = diskVersionOf(saveRef.current.phase)
    const editor = editorRef.current
    if (disk === null || editor === null) return
    applyingDiskRef.current = true
    try { editor.setValue(disk.diskContent) } finally { applyingDiskRef.current = false }
    contentRef.current = disk.diskContent
    dispatch({ kind: 'take-disk' })
  }

  if (load.kind === 'loading') {
    return (
      <RepoNote
        icon={<Loader size={15} className="ag-working-spin" />}
        text={pt ? 'Abrindo o arquivo…' : 'Opening the file…'}
      />
    )
  }

  if (load.kind === 'failed') {
    return (
      <RepoNote
        icon={<AlertTriangle size={15} style={{ color: 'var(--accent-red)' }} />}
        text={load.text}
      />
    )
  }

  if (load.kind === 'binary') {
    return <RepoNote icon={<File size={15} />} text={binaryText(load, lang)} />
  }

  return (
    <div
      // Ctrl+S reaches Monaco's own command while the editor has focus; this catches it when focus
      // is on the Save button or the banner instead, where the browser would otherwise offer to
      // save the page. `writingRef` is what stops the two paths writing twice.
      onKeyDown={ev => {
        if ((ev.ctrlKey || ev.metaKey) && (ev.key === 's' || ev.key === 'S')) {
          ev.preventDefault()
          requestSave('explicit')
        }
      }}
      style={{
        position: 'relative', flex: 1, minHeight: 0, minWidth: 0,
        display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
      }}
    >
      <RepoSaveStrip
        state={save}
        lang={lang}
        isMobile={isMobile}
        onSave={() => requestSave('explicit')}
      />

      {save.phase.kind === 'stale' && (
        <RepoStaleBanner
          lang={lang}
          isMobile={isMobile}
          autosave={autosave}
          onResave={resaveOverDisk}
          onDiscard={discardAndReload}
        />
      )}

      {/* Monaco does not scroll natively — it intercepts the wheel and moves its own content — so
          there is no scroll chain to break out of here. `contain` is set anyway, because this is the
          panel's new scrolling region as far as the rest of the layout is concerned, and the rule
          this workspace keeps is about the region, not about who implements its scrolling. */}
      <div ref={hostRef} style={{ flex: 1, minHeight: 0, minWidth: 0, overscrollBehavior: 'contain' }} />

      {save.phase.kind === 'conflict' && (
        <RepoConflictPrompt
          path={path}
          lang={lang}
          isMobile={isMobile}
          autosave={autosave}
          onResave={resaveOverDisk}
          onDiscard={discardAndReload}
          onDismiss={() => dispatch({ kind: 'dismiss-conflict' })}
        />
      )}
    </div>
  )
}

// --- the strip, the banner and the question ------------------------------------------------------
//
// All three take their state as a PROP and are exported, for the reason `RepoSearchResults` is:
// `useEffect` never runs under `renderToStaticMarkup`, so anything reachable only by fetching and
// typing could not be asserted at all.

const TONE_COLOR: Record<SaveTone, string> = {
  dim: 'var(--text-tertiary)',
  busy: 'var(--text-tertiary)',
  ok: 'var(--accent-green, #22c55e)',
  warn: 'var(--anthropic-orange)',
  bad: 'var(--accent-red)',
}

export function RepoSaveStrip({ state, lang, isMobile, onSave }: {
  state: SaveState
  lang: 'pt' | 'en'
  isMobile: boolean
  onSave: () => void
}) {
  const pt = lang === 'pt'
  const status = saveStatus(state, lang)
  const button = saveButtonState(state, lang, isMobile)
  const dirty = isDirty(state)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, boxSizing: 'border-box',
      padding: isMobile ? '5px 8px' : '3px 8px',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      {/* The dot is the dirty state said in a way that survives a column too narrow for words. */}
      <span
        data-dirty={dirty}
        aria-hidden="true"
        style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: dirty ? 'var(--anthropic-orange)' : 'transparent',
        }}
      />
      <span
        role="status"
        style={{
          flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 1.45,
          color: TONE_COLOR[status.tone],
          overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: status.tone === 'bad' ? 'normal' : 'nowrap',
        }}
      >
        {status.text}
      </span>
      <button
        type="button"
        onClick={onSave}
        disabled={!button.enabled}
        title={button.title}
        aria-label={pt ? 'Salvar o arquivo' : 'Save the file'}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          flexShrink: 0, boxSizing: 'border-box',
          // 44px of HEIGHT on a phone is the touch-target floor — and no `minWidth` beside it: this
          // button carries a word, so the label already makes it wider than a finger, and a 44x44
          // box around a labelled control is the painted square `touchTarget.lint.test.ts` refuses.
          minHeight: isMobile ? 44 : undefined,
          padding: isMobile ? '0 12px' : '3px 9px',
          borderRadius: 6, border: '1px solid var(--border-subtle)',
          background: 'transparent', fontFamily: 'inherit',
          fontSize: isMobile ? 13 : 11.5,
          color: button.enabled ? 'var(--text-primary)' : 'var(--text-tertiary)',
          cursor: button.enabled ? 'pointer' : 'not-allowed',
          opacity: button.enabled ? 1 : 0.55,
        }}
      >
        {state.phase.kind === 'saving'
          ? <Loader size={12} className="ag-working-spin" />
          : state.phase.kind === 'saved' && !dirty
            ? <Check size={12} />
            : <Save size={12} />}
        {pt ? 'Salvar' : 'Save'}
      </button>
    </div>
  )
}

/**
 * "Decide later", kept visible.
 *
 * Dismissing the question must not hide the fact: the pin is old, the next save will be refused,
 * and — when autosave is on — it has STOPPED, which is the one thing a reader who trusts autosave
 * has to be told rather than left to infer from a file that quietly stops saving itself.
 */
export function RepoStaleBanner({ lang, isMobile, autosave, onResave, onDiscard }: {
  lang: 'pt' | 'en'
  isMobile: boolean
  autosave: boolean
  onResave: () => void
  onDiscard: () => void
}) {
  const pt = lang === 'pt'
  return (
    <div
      role="status"
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
        padding: isMobile ? '8px 10px' : '6px 10px',
        minWidth: 0, boxSizing: 'border-box',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'color-mix(in srgb, var(--anthropic-orange) 10%, transparent)',
      }}
    >
      <AlertTriangle size={13} style={{ color: 'var(--anthropic-orange)', flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 140, fontSize: 11.5, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
        {pt
          ? 'Este arquivo mudou no disco depois que você abriu. Nada foi salvo.'
          : 'This file changed on disk after you opened it. Nothing has been saved.'}
        {autosave && (pt
          ? ' O salvamento automático está pausado até você escolher.'
          : ' Autosave is paused until you choose.')}
      </span>
      <ChoiceButton
        label={pt ? 'Salvar por cima' : 'Save over it'}
        icon={<Save size={12} />}
        isMobile={isMobile}
        onClick={onResave}
      />
      <ChoiceButton
        label={pt ? 'Descartar e recarregar' : 'Discard and reload'}
        icon={<RotateCcw size={12} />}
        isMobile={isMobile}
        onClick={onDiscard}
      />
    </div>
  )
}

/**
 * The conflict itself — a QUESTION, with no default answer and no pre-selected button.
 *
 * Both resolving choices lose something, and which loss is acceptable is not a thing this code can
 * know: one overwrites whatever just landed, the other throws away what the person typed. So
 * neither is styled as the safe one, and each says what it costs on its own line. `Escape` is
 * "keep editing", the only choice that destroys nothing.
 */
export function RepoConflictPrompt({ path, lang, isMobile, autosave, onResave, onDiscard, onDismiss }: {
  path: string
  lang: 'pt' | 'en'
  isMobile: boolean
  autosave: boolean
  onResave: () => void
  onDiscard: () => void
  onDismiss: () => void
}) {
  const pt = lang === 'pt'

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onDismiss() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onDismiss])

  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'absolute', inset: 0, zIndex: 30,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', padding: 14, boxSizing: 'border-box',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={pt ? 'Este arquivo mudou no disco' : 'This file changed on disk'}
        onClick={ev => ev.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420, maxHeight: '100%', overflowY: 'auto',
          overscrollBehavior: 'contain', boxSizing: 'border-box',
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
          padding: isMobile ? 16 : 18,
          display: 'flex', flexDirection: 'column', gap: 12,
          boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <span style={{
            display: 'inline-flex', padding: 7, borderRadius: 9, flexShrink: 0,
            background: 'color-mix(in srgb, var(--anthropic-orange) 16%, transparent)',
            color: 'var(--anthropic-orange)',
          }}>
            <AlertTriangle size={16} />
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', minWidth: 0 }}>
            {pt ? 'Este arquivo mudou no disco' : 'This file changed on disk'}
          </span>
        </div>

        <code style={{
          fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 11,
          color: 'var(--text-tertiary)', wordBreak: 'break-all', minWidth: 0,
        }}>
          {path}
        </code>

        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
          {pt
            ? 'Algo escreveu neste arquivo depois que ele foi aberto aqui — provavelmente o agente que trabalha nesta sessão. Nada foi salvo. Escolha o que acontece com a sua edição.'
            : 'Something wrote to this file after it was opened here — most likely the agent working in this session. Nothing was saved. Choose what happens to your edit.'}
        </p>

        <Choice
          label={pt ? 'Salvar por cima' : 'Save over it'}
          note={pt
            ? 'Mantém o que você escreveu e substitui a versão que está no disco agora.'
            : 'Keeps what you typed and replaces the version that is on disk now.'}
          icon={<Save size={13} />}
          isMobile={isMobile}
          onClick={onResave}
        />
        <Choice
          label={pt ? 'Descartar e recarregar' : 'Discard and reload'}
          note={pt
            ? 'Joga fora o que você escreveu e mostra a versão que está no disco.'
            : 'Throws away what you typed and shows the version that is on disk.'}
          icon={<RotateCcw size={13} />}
          isMobile={isMobile}
          onClick={onDiscard}
        />
        <Choice
          label={pt ? 'Continuar editando' : 'Keep editing'}
          note={pt
            ? `Decide depois. Nada é salvo enquanto isso${autosave ? ', e o salvamento automático fica pausado' : ''}.`
            : `Decide later. Nothing is saved until you do${autosave ? ', and autosave stays paused' : ''}.`}
          icon={<File size={13} />}
          isMobile={isMobile}
          onClick={onDismiss}
        />
      </div>
    </div>
  )
}

/** One of the three answers: what it is called, and what it costs. */
function Choice({ label, note, icon, isMobile, onClick }: {
  label: string
  note: string
  icon: ReactNode
  isMobile: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 9, textAlign: 'left',
        width: '100%', boxSizing: 'border-box', minWidth: 0,
        minHeight: isMobile ? 44 : undefined,
        padding: isMobile ? '10px 12px' : '8px 11px',
        borderRadius: 8, border: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)', cursor: 'pointer', fontFamily: 'inherit',
      }}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0, marginTop: 1, color: 'var(--text-secondary)' }}>
        {icon}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
        <span style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-tertiary)' }}>{note}</span>
      </span>
    </button>
  )
}

/** The banner's compact form of the same two answers. */
function ChoiceButton({ label, icon, isMobile, onClick }: {
  label: string
  icon: ReactNode
  isMobile: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        flexShrink: 0, boxSizing: 'border-box',
        minHeight: isMobile ? 44 : undefined,
        padding: isMobile ? '0 12px' : '3px 9px',
        borderRadius: 6, border: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)', cursor: 'pointer', fontFamily: 'inherit',
        fontSize: isMobile ? 13 : 11.5, color: 'var(--text-primary)',
      }}
    >
      {icon}
      {label}
    </button>
  )
}
