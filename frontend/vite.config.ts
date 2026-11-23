import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The API runs on :4000. The dev server forwards /api to it, so the browser sees one origin
// (the refresh cookie and Server-Sent Events work without CORS).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_URL || 'http://localhost:4000', changeOrigin: true } },
  },
})
