import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// identifiant de cette version : écrit dans dist/version.json et intégré à
// l'appli, qui compare les deux pour se mettre à jour toute seule (voir
// src/useAppUpdate.ts)
const BUILD_ID = String(Date.now())

function versionFile(): Plugin {
  return {
    name: 'version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionFile()],
  base: '/',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
})
