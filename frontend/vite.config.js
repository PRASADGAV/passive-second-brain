import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development, proxy to the local Docker backend (port 8090).
// In production (Vercel), VITE_API_BASE_URL is set to the Render backend URL
// so the proxy is not used at all — requests go directly to the backend.
const LOCAL_BACKEND = 'http://localhost:8090'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: LOCAL_BACKEND,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': {
        target: LOCAL_BACKEND.replace('http://', 'ws://'),
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
