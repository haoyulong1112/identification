import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(rootDir, 'dist')

function copyManifestPlugin() {
  return {
    name: 'copy-extension-manifest',
    closeBundle() {
      mkdirSync(distDir, { recursive: true })
      copyFileSync(path.resolve(rootDir, 'manifest.json'), path.resolve(distDir, 'manifest.json'))
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [vue(), copyManifestPlugin()],
  build: {
    target: 'es2020',
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        panel: path.resolve(rootDir, 'panel.html'),
      },
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
