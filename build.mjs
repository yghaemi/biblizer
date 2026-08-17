import esbuild from 'esbuild'
import { readFileSync } from 'fs'

const watch = process.argv.includes('--watch')

// Parse .env into esbuild define entries so process.env.VAR is replaced at build time
function loadEnvDefines(path = '.env') {
  const defines = {}
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/)
      if (match) {
        defines[`process.env.${match[1]}`] = JSON.stringify(match[2])
      }
    }
  } catch { /* .env is optional */ }
  return defines
}

const envDefines = loadEnvDefines()

// citation-js supports both Node and browser. When targeting the browser we
// swap out node-fetch (and its transitive Node built-ins) for native fetch.
const browserStubsPlugin = {
  name: 'browser-stubs',
  setup(build) {
    // Intercept node-fetch before esbuild scans its Node-specific deps.
    build.onResolve({ filter: /^node-fetch$/ }, () => ({
      path: 'node-fetch',
      namespace: 'browser-shim',
    }))

    // Intercept fetch-blob (dep of node-fetch) in case it slips through.
    build.onResolve({ filter: /^fetch-blob/ }, () => ({
      path: 'fetch-blob',
      namespace: 'browser-shim',
    }))

    // Stub node: protocol built-ins as empty (unused code paths in @citation-js/core).
    build.onResolve({ filter: /^node:/ }, (args) => ({
      path: args.path,
      namespace: 'node-empty',
    }))

    build.onLoad({ filter: /.*/, namespace: 'browser-shim' }, ({ path }) => {
      if (path === 'node-fetch') {
        return {
          loader: 'js',
          contents: `
const f = (typeof globalThis.fetch === 'function')
  ? globalThis.fetch.bind(globalThis)
  : () => Promise.reject(new Error('fetch is not available'));
export default f;
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
export const FormData = globalThis.FormData;
export const Blob = globalThis.Blob;
`,
        }
      }
      // fetch-blob → pass through the Blob constructor
      return {
        loader: 'js',
        contents: `export default globalThis.Blob; export const Blob = globalThis.Blob;`,
      }
    })

    build.onLoad({ filter: /.*/, namespace: 'node-empty' }, () => ({
      loader: 'js',
      contents: '',
    }))
  },
}

const buildOptions = {
  entryPoints: ['src/script.js'],
  bundle: true,
  outfile: 'script.js',
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  minify: false,
  sourcemap: process.argv.includes('--dev'),
  loader: { '.csl': 'text', '.css': 'text' },  // import as plain strings, injected at runtime
  define: envDefines,
  plugins: [browserStubsPlugin],
}

if (watch) {
  const ctx = await esbuild.context(buildOptions)
  await ctx.watch()
  console.log('Watching for changes...')
} else {
  await Promise.all([
    esbuild.build(buildOptions),
    esbuild.build({ ...buildOptions, outfile: 'script.min.js', minify: true }),
  ])
  console.log('Built → script.js, script.min.js')
}
