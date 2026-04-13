import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
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
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
    fs: {
      // Allow Vite's dev server to serve files from the project root
      // (one level above frontend/) so @shared can be resolved.
      allow: ['..'],
    },
  },
})
