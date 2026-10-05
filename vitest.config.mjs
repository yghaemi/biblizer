import { readFileSync } from 'fs'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Mirror esbuild's `.csl: 'text'` loader: import CSL XML as a plain string.
  plugins: [{
    name: 'csl-text',
    enforce: 'pre',
    load(id) {
      if (id.endsWith('.csl')) {
        return `export default ${JSON.stringify(readFileSync(id, 'utf8'))}`
      }
    },
  }],
  test: {
    environment: 'jsdom',
    environmentOptions: {
      // localhost → extractLibrary() resolves the "dev" library.
      jsdom: { url: 'http://localhost/Sandboxes/test/Test_Page' },
    },
  },
})
