import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const apiPort = process.env.PORT ?? '47291'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true, suppressWarnings: true, type: 'module' },
      includeAssets: ['favicon.ico', 'minimalistLogo.png', 'icons/*.png'],
      manifest: {
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
      },
      workbox: {
        // Cache only static assets; API calls always go to network
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    allowedHosts: true,
    host: true,
    port: 47292,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
})
