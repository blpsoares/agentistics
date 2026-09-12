import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const apiPort = process.env.PORT ?? '47291'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Service worker disabled in dev: it cached stale bundles during iteration,
      // making code changes appear not to take effect. Still enabled for prod builds.
      devOptions: { enabled: false, suppressWarnings: true, type: 'module' },
      // `icons/*.png` covers the central variants too; the central favicon needs naming.
      includeAssets: ['favicon.ico', 'favicon-central.ico', 'minimalistLogo.png', 'icons/*.png'],
      manifest: {
        name: 'Agentistics',
        short_name: 'Agentistics',
        description: 'Local analytics dashboard for AI coding assistants',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f0f12',
        theme_color: '#D97706',
        icons: [
          // Transparent mark, no backdrop — what desktop taskbars/docks draw verbatim.
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Opaque plate, glyph confined to the safe-zone circle — for OSes (Android/ChromeOS)
          // that crop icons to their own adaptive shape. A maskable icon must stay opaque
          // edge-to-edge, or the crop reveals holes; it must never double as the 'any' icon,
          // or the same edge-to-edge plate is what painted the black square being fixed here.
          { src: '/icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache only static assets; API calls always go to network
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // ...EXCEPT Monaco. `globPatterns` above is `**/*.js`, and **a precache manifest is the one
        // place a lazy chunk stops being lazy**: workbox would download the editor, its ~160 KB of
        // stylesheet and its five workers on every first visit, for every user, including everyone
        // who never opens the Repository tab — undoing the whole point of the dynamic import. It is
        // also a hard BUILD FAILURE and not merely waste: `vite-plugin-pwa` aborts when a
        // glob-matched asset passes workbox's 2 MiB ceiling, and Monaco's largest chunk is 2.66 MB.
        // Both patterns are paths this config OWNS (see `build.rollupOptions.output` below), never
        // chunk names invented by the bundler — rolldown splits Monaco into ~94 chunks called
        // `editor.api`, `toggleHighContrast`, `pgsql`… and a name-based rule would be one upstream
        // refactor away from silently precaching 14 MB again. Monaco is fetched on demand and then
        // served from the ordinary HTTP cache.
        globIgnores: ['assets/monaco/**', '**/*.worker-*.js'],
        navigateFallback: null,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  // Monaco's worker entry points are ES modules that import across several files. Vite's default
  // worker output is 'iife', which cannot express that; 'es' emits real module workers, which is
  // also what lets the json/css/html workers share one chunk of Monaco base code instead of
  // inlining a copy each.
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        // Everything Monaco emits goes under `assets/monaco/`, so `workbox.globIgnores` above can
        // exclude it by PATH. **`manualChunks` was tried first and is wrong**: collapsing Monaco
        // into one named chunk also put a `<link rel="modulepreload" href="…monaco…">` and a
        // render-blocking `<link rel="stylesheet">` into `index.html`, i.e. 4.5 MB fetched on every
        // page load — the exact opposite of what the dynamic import is for. Routing by DIRECTORY
        // leaves rolldown's own splitting alone, and `index.html` then names no Monaco asset at all.
        chunkFileNames: chunk =>
          (chunk.moduleIds ?? []).some(id => id.includes('monaco-editor'))
            ? 'assets/monaco/[name]-[hash].js'
            : 'assets/[name]-[hash].js',
        // The same for Monaco's assets, which are its CSS (~160 KB across two files) and
        // `codicon.ttf`. The test is `originalFileNames`, because that is the only field that is
        // IDENTICAL on both of the calls Vite makes per asset — it probes once with a placeholder
        // `source` before the real call, so a content test would answer differently each time and
        // the file would be named one thing and referenced as another. Monaco's CSS belongs to a
        // vendor chunk and so traces back to no source file of ours: an EMPTY origin list is the
        // signature. Every stylesheet this app writes itself carries its own origin
        // (`index.html`, `src/pages/CustomPage.tsx`, `src/components/SessionTerminal.tsx`) and
        // stays put. If some future dependency ever emits chunk-level CSS of its own, it would land
        // here too — which costs it its place in the PRECACHE and nothing else: it is still built,
        // still served, still cached by the browser. That is the direction to be wrong in.
        assetFileNames: asset => {
          const origins = asset.originalFileNames ?? []
          const fromMonaco = origins.length === 0 || origins.some(n => n.includes('monaco-editor'))
          return fromMonaco ? 'assets/monaco/[name]-[hash][extname]' : 'assets/[name]-[hash][extname]'
        },
      },
    },
  },
  server: {
    allowedHosts: true,
    host: true,
    // Dev UI port. Defaults to 47292; the central dev flow sets WEB_PORT=48080 so you open the
    // same URL as the Docker container (which publishes 48080). API stays proxied below.
    port: Number(process.env.WEB_PORT ?? 47292),
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
        // WEBSOCKETS TOO, and without this line the write channels are dead in dev while
        // everything else works. Both of them ride an upgrade (`/api/fleet/input`,
        // `/api/shell/input`); a proxy entry without `ws` forwards ordinary requests and silently
        // DROPS the handshake, so the socket times out with no status to look up — the live screen
        // keeps drawing over SSE (a plain GET) and typing into it just does nothing.
        ws: true,
      },
    },
  },
})
