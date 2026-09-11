/// <reference types="vite/client" />
/**
 * monacoSetup.ts — self-hosted Monaco, no CDN, loaded only when the Repository tab is opened.
 *
 * TWO GUARANTEES, and both are structural rather than a matter of care:
 *
 * 1. **No CDN.** Every worker below is a Vite `?worker` import, so it is bundled out of
 *    `node_modules` and served from this origin like every other asset.
 * 2. **Lazy.** Monaco is reached ONLY through the dynamic `import('monaco-editor')` in
 *    `loadMonaco()`, so it lands in its own chunk and a user who never opens the Repository tab
 *    never downloads it. **This module must itself only ever be imported dynamically**: Vite hoists
 *    the `?worker` wrappers below into the Monaco chunk, so a STATIC `import { loadMonaco }` would
 *    drag ~4.4 MB into whatever chunk wrote it.
 *
 * **The import specifiers are `monaco-editor/<path-under-esm/vs>`, NOT `monaco-editor/esm/vs/...`.**
 * monaco-editor 0.56 ships an `exports` map whose subpath pattern is `"./*": "./esm/vs/*.js"`, so
 * the `esm/vs/` prefix every pre-0.5x recipe still uses now resolves to `esm/vs/esm/vs/...` and
 * fails outright. Verified against the installed package.
 *
 * **WHY THIS FILE STILL HAS TO EXIST ON 0.56, and why it must answer EVERY label.** Measured
 * against a real production build, not assumed:
 *
 * - The four LANGUAGE workers (json, css, html, typescript) carry their own
 *   `createWorker: () => new Worker(new URL('./x.worker.js', import.meta.url), { type: 'module' })`
 *   inside monaco's own `workerManager.js`, which Vite recognises and self-hosts unaided. They are
 *   emitted into `dist/assets/` whether this file names them or not.
 * - The BASE editor worker does NOT. It offers only
 *   `esmModuleLocationBundler: () => new URL('…/editorWebWorkerMain.js', import.meta.url)` — a bare
 *   asset URL, and that 544-byte file is under Vite's inline limit, so the build turns it into a
 *   `data:text/javascript;base64,…` URL whose first line is a RELATIVE import. A relative import
 *   cannot resolve against a `data:` URL, so without the `EditorWorker` below the base worker is
 *   dead on arrival — this file's reason for existing, now demonstrated rather than believed.
 * - And `MonacoEnvironment.getWorker` is consulted BEFORE a descriptor's own `createWorker`. So
 *   defining it at all takes over for EVERY label, including the four that worked by themselves:
 *   a label `workerFor` declines is a language broken by this file, not one left alone. That is why
 *   all five are wired even though only one of them is strictly ours.
 *
 * **TypeScript is wired but switched OFF, and those are two different decisions.** The 6.9 MB
 * `ts.worker` asset is emitted by the rule above no matter what this file does, so declining the
 * label would cost the same bytes and buy a broken language. What the design spec defers is the
 * FEATURE — single-file type-checking reports confident errors for every import it cannot resolve —
 * so `disableTypeScriptServices` unregisters the providers, which is also what stops that worker
 * ever being fetched at runtime. TS/JS keep their syntax highlighting: that comes from the Monarch
 * grammar in `languages/definitions/typescript`, not from the worker. Re-enabling later is one call
 * removed from `disableTypeScriptServices`, with no build change at all.
 */
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker'
import CssWorker from 'monaco-editor/languages/features/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker?worker'
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker'

type Monaco = typeof import('monaco-editor')

/**
 * The labels Monaco actually asks for, read off the package rather than guessed:
 * `editorWorkerService` from `editor/browser/services/editorWorkerService.js`, and each language
 * feature's own `workerManager.js`, which passes the LANGUAGE ID — so one worker answers to several
 * labels (css/less/scss, html/handlebars/razor, typescript/javascript).
 */
function workerFor(label: string): Worker {
  switch (label) {
    case 'json':
      return new JsonWorker()
    case 'css':
    case 'less':
    case 'scss':
      return new CssWorker()
    case 'html':
    case 'handlebars':
    case 'razor':
      return new HtmlWorker()
    case 'typescript':
    case 'javascript':
      return new TsWorker()
    case 'editorWorkerService':
      return new EditorWorker()
    default:
      // NEVER fall back to the base editor worker. It answers the handshake and then has none of
      // the methods the asking language service calls, so the feature fails one silent rejection at
      // a time with nothing on screen naming the cause. Naming the label is what makes the next
      // language service a one-line fix instead of an investigation.
      throw new Error(
        `monacoSetup: no worker bundled for Monaco worker label "${label}". ` +
          'Add its `?worker` import and a case to workerFor() in packages/web/src/lib/monacoSetup.ts.',
      )
  }
}

type MonacoEnvironmentHost = {
  MonacoEnvironment?: { getWorker(workerId: string, label: string): Worker }
}

/**
 * Must be set BEFORE the first editor is created. Idempotent, and it never overwrites an existing
 * `MonacoEnvironment`: silently replacing a global somebody else installed is the kind of write
 * that is found months later.
 */
function armWorkers() {
  const host = self as unknown as MonacoEnvironmentHost
  if (host.MonacoEnvironment) return
  host.MonacoEnvironment = { getWorker: (_workerId, label) => workerFor(label) }
}

/**
 * Turn off every TypeScript/JavaScript language feature. With `modeConfiguration` all-false,
 * `tsMode.setupMode` registers no providers at all, so the worker is never even requested — the
 * diagnostics options beside it are belt-and-braces for anything that reads them directly.
 */
function disableTypeScriptServices(monaco: Monaco) {
  const off = {
    completionItems: false,
    hovers: false,
    documentSymbols: false,
    definitions: false,
    references: false,
    documentHighlights: false,
    rename: false,
    diagnostics: false,
    documentRangeFormattingEdits: false,
    signatureHelp: false,
    onTypeFormattingEdits: false,
    codeActions: false,
    inlayHints: false,
  }
  const noDiagnostics = {
    noSemanticValidation: true,
    noSyntaxValidation: true,
    noSuggestionDiagnostics: true,
  }
  for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
    defaults.setModeConfiguration(off)
    defaults.setDiagnosticsOptions(noDiagnostics)
  }
}

let pending: Promise<Monaco> | null = null

/**
 * Load Monaco, once. Call before the first `monaco.editor.create`.
 *
 * The PROMISE is memoized rather than the module: a second editor mounting while the first chunk is
 * still in flight must join that fetch rather than start a second one, and `disableTypeScript-
 * Services` must run exactly once, before any model exists — `languages.onLanguage('typescript')`
 * fires on the first TS model and reads `modeConfiguration` as it stands at that moment.
 */
export function loadMonaco(): Promise<Monaco> {
  if (pending) return pending
  armWorkers()
  pending = import('monaco-editor').then(monaco => {
    disableTypeScriptServices(monaco)
    return monaco
  })
  return pending
}
