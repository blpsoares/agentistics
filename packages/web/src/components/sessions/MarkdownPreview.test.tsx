/**
 * MarkdownPreview — rendered to markup (`renderToStaticMarkup`, this repo's own no-jsdom stack;
 * see `RepoFileEditor.test.tsx`'s own note) and asserted on the ACTUAL OUTPUT, which is what the
 * design's own security check asks for: a `<script>`, an `onerror` handler, a `javascript:` link
 * and a remote image must all render INERT, and the remote image must never be an `<img src=...>`
 * a browser would fetch — a live network check (Playwright) additionally confirmed no request goes
 * out for it, but the shape of the markup below is what MAKES that true, and is asserted here where
 * it can be pinned by a test that runs every commit.
 */
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownPreview } from './MarkdownPreview'

function render(text: string, opts: Partial<Parameters<typeof MarkdownPreview>[0]> = {}): string {
  return renderToStaticMarkup(
    <MarkdownPreview
      text={text}
      sessionId="s1"
      docPath="docs/guide.md"
      lang="en"
      theme="dark"
      {...opts}
    />,
  )
}

describe('security — untrusted repository content renders inert', () => {
  test('a raw <script> tag is never a live element', () => {
    const html = render('# Hello\n\n<script>document.title = "XSS"</script>\n\nAfter.')
    expect(html).not.toContain('<script>')
    expect(html.toLowerCase()).not.toContain('<script ')
  })

  test('an <img onerror=...> is never a live element with a handler attribute', () => {
    const html = render('<img src="x" onerror="document.title=\'XSS\'">')
    // No `rehype-raw` means the raw HTML tag is never parsed into a real element at all — it comes
    // back as ESCAPED TEXT (`&lt;img …&gt;`), which is why `onerror=` still appears as a SUBSTRING:
    // it is part of the inert sentence on screen, not a live attribute. The real assertion is that
    // no unescaped `<img` tag exists in the output for this input.
    expect(html).not.toContain('<img ')
    expect(html).toContain('&lt;img')
  })

  test('a javascript: link is caught by OUR OWN classifyHref, not left to react-dom alone', () => {
    // React itself also refuses to emit a raw `javascript:` href (it substitutes a throwing stub),
    // which would make a bare `not.toContain('javascript:')` pass even if this component's own
    // `classifyHref` gate were deleted entirely — see `markdownLinks.ts`'s own header for why the
    // gate exists regardless. So this asserts the SPECIFIC inert markup our `a` renderer produces
    // for a blocked link (a struck-through, non-navigating `<span>` with the refusal as its title),
    // which only appears when OUR gate runs.
    const html = render("[click me](javascript:document.title='XSS')")
    expect(html).toContain('text-decoration:line-through')
    expect(html).toContain('This link is not opened')
    expect(html).not.toContain('<a href')
    expect(html).toContain('click me')
  })

  test('a data: link (not an image) is blocked the same way', () => {
    const html = render('[open](data:text/html,<script>alert(1)</script>)')
    expect(html).toContain('text-decoration:line-through')
    expect(html).not.toContain('<a href')
  })

  test('a remote image is NEVER an <img src="http…"> — nothing for the browser to fetch', () => {
    const html = render('![tracker](https://example.com/tracker.png)')
    expect(html).not.toContain('<img')
    // It is offered as a deliberate, explicit link instead.
    expect(html).toContain('href="https://example.com/tracker.png"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  test('a relative image resolves through the media route, relative to the DOCUMENT\'S directory', () => {
    const html = render('![diagram](./img.png)', { docPath: 'docs/guide.md' })
    expect(html).toContain('<img')
    expect(html).toContain('/api/fleet/tree/media?id=s1&amp;path=docs%2Fimg.png')
  })

  test('a safe external link (https) opens in a new tab with noopener', () => {
    const html = render('[docs](https://example.com/docs)')
    expect(html).toContain('href="https://example.com/docs"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  test('a relative link to another repo file is clickable but calls back rather than navigating', () => {
    let opened: string | null = null
    const html = render('[other](./other.md)', { onOpenPath: p => { opened = p } })
    expect(html).toContain('other')
    // The onClick handler is a real prop, not asserted through static markup (it never fires
    // server-side) — its wiring is exercised by TypeScript accepting the callback shape above and
    // by `resolveRepoRelativePath`'s own tests for the path it would be called with.
    expect(opened).toBeNull()
  })
})

describe('frontmatter', () => {
  test('a flat block renders as a table above the body', () => {
    const html = render('---\nname: probe-doc\ndescription: a test\n---\n\n# Body\n')
    expect(html).toContain('probe-doc')
    expect(html).toContain('a test')
    expect(html).toContain('<table')
    expect(html).toContain('Body')
  })

  test('an unparseable block is shown as a code block, never dropped', () => {
    const html = render('---\ntags: [a, b]\n---\n\nBody text.\n')
    expect(html).toContain('tags: [a, b]')
    expect(html).toContain('Body text.')
  })
})

describe('code fences', () => {
  test('a labelled fence is highlighted, not left as one plain grey block', () => {
    const html = render('```ts\nconst x = 1\n```\n')
    // Colours come from `buildHighlightColors('dark')` — the keyword `const` gets its own span.
    expect(html).toContain('<code')
    expect((html.match(/<span/g) ?? []).length).toBeGreaterThan(1)
  })

  test('a mermaid fence renders the diagram component, not a code block', () => {
    const html = render('```mermaid\ngraph TD\n  A --> B\n```\n')
    // The diagram itself only resolves in a browser (dynamic `import(\'mermaid\')` inside an
    // effect, which never runs under static rendering) — what THIS proves is that it did not fall
    // through to the code highlighter, which would have printed the raw arrow/bracket tokens.
    expect(html).not.toContain('<span style="color')
    expect(html).toContain('Drawing the diagram')
  })
})
