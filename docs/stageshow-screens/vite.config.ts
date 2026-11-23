import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('.', import.meta.url))
export default defineConfig({ root, base: './', plugins: [react()], build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 100000000, cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } } })
