import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['favicon.svg', 'apple-touch-icon.svg', 'pwa-192x192.svg', 'pwa-512x512.svg'],
        manifest: {
          name: 'DormAxis — PG Management',
          short_name: 'DormAxis',
          description: 'PG & Hostel management platform for owners',
          theme_color: '#45a793',
          background_color: '#ffffff',
          display: 'standalone',
          scope: '/',
          start_url: '/',
          orientation: 'portrait-primary',
          icons: [
            {
              src: 'pwa-192x192.svg',
              sizes: '192x192',
              type: 'image/svg+xml',
              purpose: 'any',
            },
            {
              src: 'pwa-512x512.svg',
              sizes: '512x512',
              type: 'image/svg+xml',
              purpose: 'any',
            },
            {
              src: 'pwa-512x512.svg',
              sizes: '512x512',
              type: 'image/svg+xml',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              // API calls: always try network first, fall back to stale cache for 1 hour
              urlPattern: /^\/api\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-cache',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60,
                },
                networkTimeoutSeconds: 10,
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Google Fonts and other external resources
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    build: {
      target: 'es2020',
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router-dom/') || id.includes('node_modules/scheduler/')) {
              return 'react-vendor'
            }
            if (id.includes('node_modules/recharts/') || id.includes('node_modules/d3-') || id.includes('node_modules/victory-vendor/')) {
              return 'charts'
            }
            if (id.includes('node_modules/lucide-react/')) {
              return 'icons'
            }
            if (id.includes('node_modules/axios/')) {
              return 'http'
            }
          },
        },
      },
    },
    resolve: {
      alias: {
        // Backend consumes /shared/calculateRent.js  (CJS, via require).
        // Vite cannot transform CJS source files outside node_modules, so we
        // point the frontend at the ESM mirror (.mjs) instead.
        // All other @shared/* imports (if any) fall through to the directory alias.
        '@shared/calculateRent': path.resolve(__dirname, '../shared/calculateRent.mjs'),
        '@shared': path.resolve(__dirname, '../shared'),
      },
    },
    server: {
      port: Number(env.DEV_PORT) || 3000,
      proxy: {
        '/api': {
          target: env.API_URL || 'http://localhost:5001',
          changeOrigin: true,
        },
      },
      fs: {
        // Allow Vite's dev server to serve files from the project root
        // (one level above frontend/) so @shared can be resolved.
        allow: ['..'],
      },
    },
  }
})
