import { readFileSync } from 'fs'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Mirror esbuild's `.xml: 'text'` loader: import the CSL locale XML as a plain string.
  plugins: [{
    name: 'xml-text',
    enforce: 'pre',
    load(id) {
      if (id.endsWith('.xml')) {
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
