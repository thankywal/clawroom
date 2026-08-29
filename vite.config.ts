import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Three entry points: the room itself, the tool self-test, and the raw WebMCP
// capability probe. The last two are diagnostics that ship with the project so
// anyone can check the platform underneath it.
const entry = (name: string) => fileURLToPath(new URL(name, import.meta.url))

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: entry('index.html'),
        room: entry('room.html'),
        selftest: entry('selftest.html'),
        ablate: entry('ablate.html'),
        smoke: entry('smoke.html'),
      },
    },
  },
})
