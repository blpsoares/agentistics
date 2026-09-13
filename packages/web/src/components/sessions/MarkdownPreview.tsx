/**
 * MarkdownPreview — one markdown document, rendered.
 *
 * **NO `rehype-raw`.** A repository file is untrusted input; without it, `react-markdown` never
 * turns a raw `<script>`/`<img onerror>` tag into a live DOM element — an HTML block in the source
 * is either dropped or shown as inert text, and this component adds nothing that would change that.
 * `urlTransform` is overridden to the identity function so that EVERY decision about a link's or an
 * image's target is made by THIS file's own `classifyHref`/`classifyImgSrc`
 * (`lib/markdownLinks.ts`) rather than by react-markdown's own (undocumented-here) default —
 * auditable in one place, and exactly what the design's security check drives against: a
 * `javascript:` link renders inert, a remote `<img>` is never requested (see `img` below — it never
 * exists as an `<img src="http…">`, so there is nothing for the network tab to show), and raw HTML
 * stays text.
 *
 * **FRONTMATTER** (`lib/frontmatter.ts`) is pulled off the top and shown as a table above the body —
 * or, when it cannot be read as the small flat shape that module understands, as a code fence
 * instead: "shown as a code block, never dropped" is the promise; NEVER the body flowing straight
 * through with the fence lines mistaken for prose.
 *
 * **STYLING reuses `.ag-chat-md`** — the class `ArtifactDoc`/`ChatBubble` already draw `react-
 * markdown` output through — for everything BUT code fences: a heading, a table, a link all read the
 * same whether they arrived in a chat bubble or a repository file, and CLAUDE.md already asks for
 * one CSS rule rather than one per surface. Code, mermaid and the frontmatter table are this
 * component's OWN, laid on top: `.ag-chat-md pre` already gives a fenced block its box (background,
 * border, padding, horizontal scroll), so `code` below only has to decide WHAT is inside it —
 * per-token colour (`FencedCodeBlock`, the same palette `ArtifactDoc`'s `CodeView` reads via
 * `buildHighlightColors`, commit 80e956fd) or a diagram (`MermaidDiagram`) — and never re-draws the
 * box itself, which is how a highlighted fence and a plain one stay ONE background instead of two.
 */

import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AlertTriangle } from 'lucide-react'
import { parseFrontmatter } from '../../lib/frontmatter'
import { classifyHref, classifyImgSrc, resolveRepoRelativePath } from '../../lib/markdownLinks'
import { highlight, type Token, type TokenKind } from '../../lib/codeHighlight'
import { buildHighlightColors, type CodeThemeVariant } from '../../lib/monacoTheme'
import { repoMediaUrl } from '../../lib/attachmentUrl'
import { MermaidDiagram } from './MermaidDiagram'

export interface MarkdownPreviewProps {
  /** The live buffer — unsaved edits show, per the toggle's own contract. */
  text: string
  sessionId: string
  /** This document's own path, relative to the session's tree root — resolves every relative link
   * and image against ITS directory, not the tree root. */
  docPath: string
  lang: 'pt' | 'en'
  theme: CodeThemeVariant
  /**
   * Opens another repository file in the Studio. Absent (no caller has wired the Studio's tab
   * system to this preview yet) leaves an internal link CLICKABLE but INERT — see the `a` renderer
   * below — rather than guessing at a navigation this component has no way to perform honestly.
   */
  onOpenPath?: (path: string) => void
}

// A fenced block's info-string language, mapped onto the small set `codeHighlight.ts` actually
// knows. Unlisted (including no language at all) renders PLAIN — that lexer's own rule, applied
// here at one remove: a language it cannot lex is never mis-coloured.
const FENCE_LANG: Record<string, string> = {
  typescript: 'ts', ts: 'ts', tsx: 'ts',
  javascript: 'js', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  python: 'py', py: 'py',
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', console: 'sh',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'css',
}

function childrenToText(children: ReactNode): string {
  if (Array.isArray(children)) return children.map(childrenToText).join('')
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  return ''
}

const COLOR_FOR = (colours: ReturnType<typeof buildHighlightColors>): Record<TokenKind, string> => ({
  plain: colours.plain,
  comment: colours.comment,
  string: colours.string,
  number: colours.number,
  keyword: colours.keyword,
  punct: colours.punct,
})

/**
 * A highlighted fence — NO box of its own; `.ag-chat-md pre` already draws it, and `.ag-chat-md pre
 * code` already resets padding/border/background to nothing and sets `white-space: pre`, which is
 * what lets the plain `\n` between lines below stand as real line breaks.
 */
function FencedCodeBlock({ text, fenceLang, theme }: {
  text: string; fenceLang: string; theme: CodeThemeVariant
}) {
  const kind = FENCE_LANG[fenceLang.toLowerCase()] ?? null
  const lines: Token[][] = highlight(text, kind)
  const colour = COLOR_FOR(buildHighlightColors(theme))
  return (
    <code>
      {lines.map((toks, i) => (
        <span key={i}>
          {toks.map((t, j) => <span key={j} style={{ color: colour[t.kind] }}>{t.text}</span>)}
          {i < lines.length - 1 ? '\n' : null}
        </span>
      ))}
    </code>
  )
}

const FRONTMATTER_LABEL = { en: 'Frontmatter', pt: 'Frontmatter' }
const FRONTMATTER_UNPARSED = {
  en: 'This block is not a simple list of fields — shown as written:',
  pt: 'Este bloco não é uma lista simples de campos — mostrado como está escrito:',
}
const REMOTE_IMAGE_FALLBACK = { en: 'remote image', pt: 'imagem remota' }
const BLOCKED_LINK_TITLE = {
  en: 'This link is not opened — its address is not one this preview allows.',
  pt: 'Este link não é aberto — o endereço dele não é permitido nesta pré-visualização.',
}

function FrontmatterTable({ data, lang }: { data: Map<string, string>; lang: 'pt' | 'en' }) {
  const pt = lang === 'pt'
  return (
    <table
      style={{
        display: 'block', maxWidth: '100%', overflowX: 'auto', borderCollapse: 'collapse',
        margin: '0 0 14px', fontSize: 12,
        border: '1px solid var(--border-subtle)', borderRadius: 8,
      }}
    >
      <caption style={{
        captionSide: 'top', textAlign: 'left', padding: '5px 9px', fontSize: 10.5,
        fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
        color: 'var(--text-tertiary)',
      }}>
        {pt ? FRONTMATTER_LABEL.pt : FRONTMATTER_LABEL.en}
      </caption>
      <tbody>
        {[...data.entries()].map(([key, value]) => (
          <tr key={key} style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <td style={{
              padding: '4px 9px', verticalAlign: 'top', fontWeight: 600, whiteSpace: 'nowrap',
              color: 'var(--text-secondary)',
            }}>
              {key}
            </td>
            <td style={{
              padding: '4px 9px', verticalAlign: 'top', color: 'var(--text-primary)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {value === '' ? '—' : value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function identity(url: string): string {
  return url
}

export function MarkdownPreview({ text, sessionId, docPath, lang, theme, onOpenPath }: MarkdownPreviewProps) {
  const pt = lang === 'pt'
  const front = parseFrontmatter(text)

  return (
    <div className="ag-chat-md" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      {front.present && front.data !== null && front.data.size > 0 && (
        <FrontmatterTable data={front.data} lang={lang} />
      )}
      {front.present && front.data === null && (
        <div style={{ marginBottom: 14 }}>
          <p style={{
            margin: '0 0 4px', fontSize: 11, color: 'var(--text-tertiary)',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <AlertTriangle size={11} />
            {pt ? FRONTMATTER_UNPARSED.pt : FRONTMATTER_UNPARSED.en}
          </p>
          <pre style={{
            margin: 0, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-base)',
            border: '1px solid var(--border-subtle)', maxWidth: '100%', overflowX: 'auto',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, monospace",
            fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-secondary)', whiteSpace: 'pre',
          }}>
            {front.raw}
          </pre>
        </div>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={identity}
        components={{
          a({ href, children }) {
            const h = href ?? ''
            const kind = classifyHref(h)
            if (kind === 'blocked') {
              return (
                <span
                  title={pt ? BLOCKED_LINK_TITLE.pt : BLOCKED_LINK_TITLE.en}
                  style={{ color: 'var(--text-tertiary)', textDecoration: 'line-through', cursor: 'not-allowed' }}
                >
                  {children}
                </span>
              )
            }
            if (kind === 'external') {
              return (
                <a href={h} target="_blank" rel="noopener noreferrer">{children}</a>
              )
            }
            const resolved = resolveRepoRelativePath(docPath, h)
            return (
              <a
                href={h}
                onClick={ev => {
                  ev.preventDefault()
                  onOpenPath?.(resolved)
                }}
              >
                {children}
              </a>
            )
          },
          img({ src, alt }) {
            const s = src ?? ''
            if (classifyImgSrc(s) === 'remote') {
              // NEVER fetched — see the header. Rendered as a link so the reader can still open it
              // deliberately, with the alt text (or a stated fallback) as the only thing shown.
              return (
                <a href={s} target="_blank" rel="noopener noreferrer">
                  {alt && alt.trim() !== '' ? alt : (pt ? REMOTE_IMAGE_FALLBACK.pt : REMOTE_IMAGE_FALLBACK.en)}
                </a>
              )
            }
            const resolved = resolveRepoRelativePath(docPath, s)
            const url = s.startsWith('data:') ? s : repoMediaUrl(sessionId, resolved)
            return <img src={url} alt={alt ?? ''} style={{ maxWidth: '100%', borderRadius: 6 }} />
          },
          code({ className, children }) {
            const match = /language-(\S+)/.exec(className ?? '')
            if (match === null) return <code>{children}</code>
            const fenceLang = match[1]!
            const raw = childrenToText(children).replace(/\n$/, '')
            if (fenceLang.toLowerCase() === 'mermaid') {
              return <MermaidDiagram source={raw} theme={theme === 'light' ? 'light' : 'dark'} lang={lang} />
            }
            return <FencedCodeBlock text={raw} fenceLang={fenceLang} theme={theme} />
          },
        }}
      >
        {front.body}
      </ReactMarkdown>
    </div>
  )
}
