/**
 * MermaidDiagram — one mermaid source block, drawn as an SVG.
 *
 * `mermaid` IS SELF-HOSTED (it is `packages/web`'s own dependency, pinned exactly — see
 * `package.json`) AND IS NEVER IN THE INITIAL BUNDLE: the `import('mermaid')` below is a dynamic
 * import reached only from inside `useEffect`, i.e. only once a diagram is actually on screen,
 * exactly the discipline `monacoEntry.ts`/`monacoSetup.ts` already keep for Monaco. Vite gives that
 * dynamic import its OWN chunk automatically; `vite.config.ts`'s `workbox.globIgnores` excludes it
 * from the PWA precache manifest for the same load-bearing reason Monaco's chunk is excluded there —
 * see that file's own comment.
 *
 * `securityLevel: 'strict'` IS WHAT MAKES `dangerouslySetInnerHTML` BELOW SAFE. Mermaid's own
 * `render()` runs the finished SVG through DOMPurify whenever the level is not `'loose'`
 * (`mermaid.core.mjs`'s `serializeSvg`, read before this was written) — this component does not
 * re-sanitize, because a second sanitizer with different rules is a second place for the two to
 * disagree about what is safe, and mermaid's own is what the security level is actually configuring.
 * A repository file is untrusted input, so this is the one place in the Studio's rendered-document
 * feature that touches `dangerouslySetInnerHTML` at all — everywhere else (`MarkdownPreview`) goes
 * through React's own escaping via `react-markdown` with no `rehype-raw`.
 *
 * A DIAGRAM THAT FAILS TO PARSE SHOWS MERMAID'S OWN ERROR SENTENCE PLUS THE SOURCE — never a blank
 * box. The failure is exactly as informative as opening the same text in mermaid's own live editor,
 * and the source stays on screen so the reader can see what they typed without switching back to
 * the code view first.
 */

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { TOKENS_DARK, TOKENS_LIGHT, flatten, type ThemeTokens } from '../../lib/monacoTheme'

export type MermaidThemeVariant = 'dark' | 'light'

export interface MermaidDiagramProps {
  /** The diagram's own text — the fence's content, or a whole `.mmd`/`.mermaid` file. */
  source: string
  theme: MermaidThemeVariant
  lang: 'pt' | 'en'
}

// One module-wide load, shared by every diagram on screen — a second `import('mermaid')` while the
// first is in flight would start a second network fetch of the same chunk for nothing.
let mermaidLoad: Promise<typeof import('mermaid')> | null = null
function loadMermaid(): Promise<typeof import('mermaid')> {
  if (mermaidLoad === null) mermaidLoad = import('mermaid')
  return mermaidLoad
}

let idSeq = 0

/**
 * mermaid's `theme: 'base'` reads its palette from `themeVariables`, and `flatten` is what turns
 * this app's own semi-transparent tokens (`rgba(255,255,255,0.55)` and friends) into the OPAQUE hex
 * mermaid needs — the exact composite `monacoTheme.ts` already computes for Monaco's own theme, over
 * the SAME ground colour, so a diagram reads as part of the Studio rather than a pasted-in widget.
 */
export function mermaidThemeVariables(tokens: ThemeTokens): Record<string, string> {
  const bg = tokens.bgBase
  return {
    background: bg,
    primaryColor: flatten(tokens.bgElevated, bg),
    primaryTextColor: flatten(tokens.textPrimary, bg),
    primaryBorderColor: flatten(tokens.orange, bg),
    secondaryColor: flatten(tokens.bgCard, bg),
    tertiaryColor: flatten(tokens.bgElevated, bg),
    lineColor: flatten(tokens.textTertiary, bg),
    textColor: flatten(tokens.textPrimary, bg),
    mainBkg: flatten(tokens.bgElevated, bg),
    nodeBorder: flatten(tokens.orange, bg),
    clusterBkg: flatten(tokens.bgCard, bg),
    clusterBorder: flatten(tokens.border, bg),
    edgeLabelBackground: bg,
    titleColor: flatten(tokens.textPrimary, bg),
    errorBkgColor: flatten(tokens.red, bg),
    errorTextColor: flatten(tokens.red, bg),
    fontFamily: "'Inter', -apple-system, 'Segoe UI', sans-serif",
  }
}

function tokensFor(theme: MermaidThemeVariant): ThemeTokens {
  return theme === 'dark' ? TOKENS_DARK : TOKENS_LIGHT
}

type DrawState =
  | { kind: 'loading' }
  | { kind: 'ready'; svg: string }
  | { kind: 'error'; message: string }

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Mermaid's own scratch element id for one render call — `d<id>`, distinct from the `<id>`
 * `render()` returns the finished SVG under. Exported so a test can prove the id this component
 * asks to remove is the exact one mermaid would have left behind, not a guess. */
export function mermaidScratchElementId(renderId: string): string {
  return `d${renderId}`
}

/** The one DOM method this belt-and-suspenders cleanup needs — kept this narrow so a test can hand
 * it a plain object instead of a real `document`. */
interface ScratchElementHost {
  getElementById(id: string): { remove(): void } | null
}

/**
 * Removes the stray scratch element mermaid's `render()` can still attach directly to
 * `document.body` on a failed parse (see `MermaidDiagram`'s own `initialize` call for why
 * `suppressErrorRendering` should already have stopped this on every path this component reaches —
 * this is the belt, for whichever path does not). Idempotent and safe to call unconditionally:
 * answers whether anything was actually removed, and never throws when there was nothing to remove.
 */
export function removeMermaidScratchElement(host: ScratchElementHost, renderId: string): boolean {
  const el = host.getElementById(mermaidScratchElementId(renderId))
  if (el === null) return false
  el.remove()
  return true
}

/**
 * The root `<svg>`'s viewBox width, PIXELS — mermaid's own "how wide is this diagram, really" —
 * or `null` when the markup carries no `viewBox` to read (never guessed at).
 */
const VIEWBOX_WIDTH = /<svg\b[^>]*\bviewBox="0 0 ([\d.]+) [\d.]+"/

/**
 * Mermaid emits its root `<svg>` at `width="100%"` with `style="max-width:<viewBox width>px"` —
 * meant to shrink a diagram to fit a narrow READING column, which is the opposite of what this
 * component wants: the diagram sits inside its OWN `overflowX: auto` box (see the return below),
 * so the right behaviour is to draw at natural size and let THAT box scroll. Left alone, the SVG
 * never overflows its box at all — there is nothing to scroll — and a six-node flowchart shrank to
 * ~4px, unreadable text on a 390px column (I4).
 *
 * Both substitutions are scoped to the OPENING `<svg …>` tag alone (`[^>]*` cannot cross the `>`
 * that ends it), so a `width="…"` or a `max-width:` appearing later, inside the diagram's own
 * nodes, is never touched. A markup with no `viewBox` (should never happen — mermaid always emits
 * one — but "refuse, never guess" applies here too) is returned untouched rather than rewritten
 * from an invented number.
 */
export function widenSvgToNaturalSize(svg: string): string {
  const vb = VIEWBOX_WIDTH.exec(svg)
  if (vb === null) return svg
  const width = vb[1]!
  return svg
    .replace(/(<svg\b[^>]*\bwidth=")[^"]*(")/, `$1${width}$2`)
    .replace(/(<svg\b[^>]*\bstyle="[^"]*max-width:)[^;"]*(;?[^"]*")/, `$1 none$2`)
}

export function MermaidDiagram({ source, theme, lang }: MermaidDiagramProps) {
  const pt = lang === 'pt'
  const [state, setState] = useState<DrawState>({ kind: 'loading' })
  const idRef = useRef<string>('')
  if (idRef.current === '') idRef.current = `ag-mermaid-${++idSeq}`

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    loadMermaid()
      .then(async mod => {
        if (cancelled) return
        const mermaid = mod.default
        mermaid.initialize({
          startOnLoad: false,
          // Without this, a parse failure inside `render()` leaves mermaid's own error graphic —
          // a full "Syntax error in text / mermaid version …" SVG — as a live child of
          // `document.body`, outside this component's tree entirely, so React never gets a chance
          // to clean it up on unmount or re-render. Every failed render left one behind, forever;
          // combined with I1's remount-per-poll, a single bad fence grew the document by dozens of
          // orphans and thousands of pixels within a minute. `suppressErrorRendering` stops mermaid
          // from drawing that graphic in the first place — the `catch` below still runs and this
          // component still shows its own error message.
          suppressErrorRendering: true,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: mermaidThemeVariables(tokensFor(theme)),
          // A label rendered as HTML (a `<div>`/`<span>` in a `foreignObject`, mermaid's default)
          // can still carry an `<img src>` after mermaid's own DOMPurify pass — sanitizing strips
          // `onerror` and the like but keeps the tag itself, so a repository file could put a
          // tracking pixel, or a same-origin `/api/...` credentialed GET, inside a node's own label
          // (I2). `false` here makes mermaid draw every label as plain SVG `<text>` instead — there
          // is no HTML inside an SVG `<text>` node for an `<img>` tag to hide in. This is the
          // ROOT-level setting (mermaid's own docs mark the per-diagram `flowchart.htmlLabels` and
          // friends deprecated in its favour, and say the root one takes precedence), so it applies
          // to every diagram type this component draws, not only flowcharts.
          htmlLabels: false,
        })
        const { svg: rawSvg } = await mermaid.render(idRef.current, source)
        if (!cancelled) setState({ kind: 'ready', svg: widenSvgToNaturalSize(rawSvg) })
      })
      .catch((err: unknown) => {
        removeMermaidScratchElement(document, idRef.current)
        if (!cancelled) setState({ kind: 'error', message: errorMessageOf(err) })
      })
    return () => { cancelled = true }
  }, [source, theme])

  if (state.kind === 'loading') {
    return (
      <div style={{ padding: '10px 4px', fontSize: 12, color: 'var(--text-tertiary)' }}>
        {pt ? 'Desenhando o diagrama…' : 'Drawing the diagram…'}
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div
        style={{
          borderRadius: 9, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
          padding: 10, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <AlertTriangle size={13} style={{ color: 'var(--accent-red)', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {pt ? 'Não foi possível desenhar este diagrama.' : 'This diagram could not be drawn.'}
          </span>
        </div>
        <pre style={{
          margin: 0, fontSize: 11, lineHeight: 1.5, color: 'var(--accent-red)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {state.message}
        </pre>
        <pre style={{
          margin: 0, padding: 8, borderRadius: 6, background: 'var(--bg-elevated)',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, monospace",
          fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-secondary)',
          whiteSpace: 'pre', overflowX: 'auto', maxWidth: '100%',
        }}>
          {source}
        </pre>
      </div>
    )
  }

  return (
    // The diagram scrolls INSIDE its own box rather than widening the document — a wide flowchart
    // must not be how a 390px column starts scrolling sideways.
    <div
      style={{ maxWidth: '100%', overflowX: 'auto', overscrollBehavior: 'contain' }}
      // SAFE: see the header — mermaid's own `securityLevel: 'strict'` sanitizes this string.
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  )
}
