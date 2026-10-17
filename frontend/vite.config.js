import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development the API runs on :8000; requests to /api and /media are proxied there.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // libraries change rarely, so keep them in their own files the browser can cache between releases
        manualChunks: (id) => (id.includes('node_modules') ? (/react|scheduler|react-router|@remix-run/.test(id) ? 'vendor-react' : /axios/.test(id) ? 'vendor-axios' : undefined) : undefined),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
      '/media': 'http://localhost:8000',
    },
  },
})
