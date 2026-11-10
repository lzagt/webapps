import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'

// Single source of truth: reuse emulator ports declared in firebase.json
function readEmulatorPorts() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'firebase.json'), 'utf8'))
    return {
      firestore: cfg.emulators?.firestore?.port,
      auth: cfg.emulators?.auth?.port
    }
  } catch {
    return {}
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  define: {
    __FIREBASE_EMULATOR_PORTS__: JSON.stringify(readEmulatorPorts())
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    host: true,
    port: 3000
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('firebase')) {
              return 'firebase';
            }
            return 'vendor';
          }
        }
      }
    }
  }
})
