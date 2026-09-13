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
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: mermaidThemeVariables(tokensFor(theme)),
        })
        const { svg } = await mermaid.render(idRef.current, source)
        if (!cancelled) setState({ kind: 'ready', svg })
      })
      .catch((err: unknown) => {
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
