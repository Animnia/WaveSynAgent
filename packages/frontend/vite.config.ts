import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  // The repo-root .env is the single source of truth for local dev ports:
  // agent-server reads the same file via pydantic-settings (PORT), so both
  // sides of the /agent-api proxy always agree.
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '../..'), '')
  const agentPort = rootEnv.PORT || '3002'
  const apiPort = rootEnv.API_SERVER_PORT || '3001'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': `http://localhost:${apiPort}`,
        '/ws': {
          target: `ws://localhost:${apiPort}`,
          ws: true,
        },
        '/agent-api': {
          target: `http://localhost:${agentPort}`,
          ws: true,
          rewrite: (path) => path.replace(/^\/agent-api/, ''),
        },
      },
    },
  }
})
