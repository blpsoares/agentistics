import { test, expect } from 'bun:test'
import { centralManifest, centralHtml, CENTRAL_APP_NAME, CENTRAL_THEME_COLOR } from './central-branding'

// The manifest vite-plugin-pwa emits, and the built shell (source index.html + the tags Vite
// injects). Kept verbatim so a change to either is caught here rather than in the dock.
const MANIFEST = JSON.stringify({
  name: 'Agentistics',
  short_name: 'Agentistics',
  description: 'Local analytics dashboard for AI coding assistants',
  start_url: '/',
  display: 'standalone',
  background_color: '#0f0f12',
  theme_color: '#D97706',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
})

const HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <meta name="apple-mobile-web-app-title" content="Agentistics" />
    <meta name="theme-color" content="#D97706" />
    <link rel="apple-touch-icon" href="/icons/icon-192.png" />
    <title>Agentistics</title>
    <script type="module" crossorigin src="/assets/index-a1b2c3.js"></script>
    <link rel="manifest" href="/manifest.webmanifest">
  </head>
  <body><div id="root"></div></body>
</html>`

test('centralManifest renames the app and swaps every icon', () => {
  const m = JSON.parse(centralManifest(MANIFEST))
  expect(m.name).toBe(CENTRAL_APP_NAME)
  expect(m.short_name).toBe(CENTRAL_APP_NAME)
  expect(m.theme_color).toBe(CENTRAL_THEME_COLOR)
  expect(m.icons.map((i: { src: string }) => i.src)).toEqual([
    '/icons/icon-central-192.png',
    '/icons/icon-central-512.png',
  ])
  // Everything else survives — sizes/purpose drive how the OS renders the installed icon.
  expect(m.icons[1]).toMatchObject({ sizes: '512x512', type: 'image/png', purpose: 'any maskable' })
  expect(m.start_url).toBe('/')
  expect(m.display).toBe('standalone')
  expect(m.background_color).toBe('#0f0f12')
})

test('centralHtml rewrites title, iOS name, touch icon, favicon and theme colour', () => {
  const html = centralHtml(HTML)
  expect(html).toContain(`<title>${CENTRAL_APP_NAME}</title>`)
  expect(html).toContain(`<meta name="apple-mobile-web-app-title" content="${CENTRAL_APP_NAME}" />`)
  expect(html).toContain(`<meta name="theme-color" content="${CENTRAL_THEME_COLOR}" />`)
  expect(html).toContain('href="/icons/icon-central-192.png"')
  expect(html).toContain('href="/favicon-central.ico"')
  // No machine-branded reference may survive, or the dock shows the amber icon anyway.
  expect(html).not.toContain('"/favicon.ico"')
  expect(html).not.toContain('"/icons/icon-192.png"')
  expect(html).not.toContain('#D97706')
})

test('centralHtml leaves the bundle and the manifest link alone', () => {
  const html = centralHtml(HTML)
  expect(html).toContain('src="/assets/index-a1b2c3.js"')
  expect(html).toContain('href="/manifest.webmanifest"')
})

test('a cosmetic rewrite can never break the shell or the manifest', () => {
  // Malformed / unexpected input is returned untouched rather than throwing or emitting junk.
  expect(centralManifest('not json at all')).toBe('not json at all')
  expect(centralManifest('null')).toBe('null')
  expect(centralHtml('<html><body>no head tags</body></html>'))
    .toBe('<html><body>no head tags</body></html>')
  // An icon entry with no usable src is passed through instead of being dropped.
  const odd = JSON.parse(centralManifest(JSON.stringify({ icons: [{ sizes: '1x1' }, null] })))
  expect(odd.icons).toEqual([{ sizes: '1x1' }, null])
})

test('centralManifest is idempotent — re-serving an already-branded manifest is stable', () => {
  const once = centralManifest(MANIFEST)
  expect(centralManifest(once)).toBe(once)
})
