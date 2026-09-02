import { describe, expect, it } from 'bun:test'
import { dashboardHtml, escapeAttr, escapeText, frameOrigin, sessionsHtml } from './html'

const SHELL = {
  cspSource: 'vscode-webview://abc',
  nonce: 'n0nc3',
  scriptUri: 'vscode-webview://abc/dist/webview.js',
  styleUri: 'vscode-webview://abc/media/style.css',
}

describe('sessionsHtml', () => {
  it('locks the document down and admits the script by nonce', () => {
    // A webview's asset origin is shared with every other extension's webview, so an origin
    // allowance is not the guarantee it looks like.
    const html = sessionsHtml(SHELL)
    expect(html).toContain("default-src &#39;none&#39;")
    expect(html).toContain("script-src &#39;nonce-n0nc3&#39;")
    expect(html).toContain('nonce="n0nc3"')
    expect(html).not.toContain("script-src 'unsafe-inline'")
  })

  it('admits inline STYLE, because a terminal frame is coloured per character run', () => {
    // Without it the browser drops every `style` attribute the ANSI renderer emits: the screen is
    // undifferentiated white text and the cursor — whose appearance is an inverted background —
    // vanishes. Script stays nonce-only, which is the half that matters.
    const html = sessionsHtml(SHELL)
    expect(html).toContain("style-src vscode-webview://abc &#39;unsafe-inline&#39;")
    expect(html).toContain("script-src &#39;nonce-n0nc3&#39;")
  })
})

const TEXT = { notice: 'unreadable', bar: 'Showing', openExternal: 'Open in a browser' }

describe('dashboardHtml', () => {
  it('admits exactly one frame origin — the one it is showing', () => {
    const html = dashboardHtml('http://127.0.0.1:47292/', SHELL, TEXT)
    expect(html).toContain('frame-src http://127.0.0.1:47292')
    expect(html).toContain('<iframe src="http://127.0.0.1:47292/"')
  })

  it('narrows a URL with a path down to its origin for the policy', () => {
    // A CSP source carrying a path is not the narrowing it appears to be.
    const html = dashboardHtml('http://127.0.0.1:47292/repositories', SHELL, TEXT)
    expect(html).toContain('frame-src http://127.0.0.1:47292"')
    expect(html).not.toContain('frame-src http://127.0.0.1:47292/repositories')
  })

  it('says so rather than framing nothing when the address is unusable', () => {
    const html = dashboardHtml('not a url', SHELL, { ...TEXT, notice: 'The dashboard address cannot be read.' })
    expect(html).toContain("frame-src &#39;none&#39;")
    expect(html).toContain('The dashboard address cannot be read.')
    expect(html).not.toContain('<iframe')
  })

  it('refuses a scheme no frame can load', () => {
    expect(frameOrigin('file:///etc/passwd')).toBeNull()
    expect(frameOrigin('javascript:alert(1)')).toBeNull()
  })

  it('escapes a hostile setting instead of writing it into the markup', () => {
    // `agentistics.dashboardUrl` is settable by a workspace, and a workspace is not necessarily
    // the user's own.
    const hostile = 'http://127.0.0.1:47292/"><script>fetch("//evil")</script>'
    const html = dashboardHtml(hostile, SHELL, TEXT)
    expect(html).not.toContain('<script>fetch')
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
  })
})

describe('escaping', () => {
  it('closes every way out of an attribute', () => {
    expect(escapeAttr(`a"b'c<d>e&f`)).toBe('a&quot;b&#39;c&lt;d&gt;e&amp;f')
  })

  it('closes every way into a tag from text', () => {
    expect(escapeText('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;')
  })
})
