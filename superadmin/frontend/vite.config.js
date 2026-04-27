import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      port: Number(env.DEV_PORT) || 5174,
      proxy: {
        '/api': {
          target: env.API_URL || 'http://localhost:5001',
          changeOrigin: true,
        },
      },
    },
  }
})
