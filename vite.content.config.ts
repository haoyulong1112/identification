import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    target: 'es2020',
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: path.resolve(rootDir, 'src/content/content-script.ts'),
      formats: ['iife'],
      fileName: () => 'content/content-script.js',
      name: 'AiDevConsoleContentScript',
    },
  },
})
